import type { ExploreItem, RankingWeightRow } from "@projective/types/explore";

/**
 * ranking — the discovery quality score (PRODUCT_SPEC §Reputation & Discovery).
 *
 * One number per item that every "recommended" ordering reads: the order the catalogue is assembled
 * in, the Home feed's ranked lists and a `?sort=recommended` search. PURE over what it is handed —
 * the catalogue loader (`./live-catalog.ts`) gathers each item's {@link RankSignals} and the live
 * `search.search_weights` coefficients — so the same inputs always rank the same way, on the server
 * and in a test.
 *
 * ```
 * total = standing × (sentiment + volume + availability + boost) + penalty
 * ```
 *
 * - **Sentiment, with a cold-start prior.** An item's rating is shrunk toward the corpus mean by
 *   {@link PRIOR_REVIEWS} pseudo-reviews, so a newcomer with no reviews starts at the marketplace's
 *   average instead of at zero, and one five-star review cannot outrank fifty 4.9s.
 * - **Volume.** Review count, saturating logarithmically at {@link VOLUME_SATURATION}: the first
 *   reviews matter most, and a long-established record stops compounding — the entrenchment the spec's
 *   Discovery Loop exists to prevent.
 * - **Availability (workload-aware).** The share of the owner's Global Intensity Cap still free. At the
 *   cap it is zero, which is how a busy high-reputation seller's ranking is temporarily lowered.
 * - **Discovery Boost.** The "fighting chance": new or first-rung talent that is fully available, with
 *   a clean (even if short) record — {@link earnsDiscoveryBoost}.
 * - **Standing.** The rung's discovery multiplier (`org.standing_levels.discovery_weight_bp`) scales
 *   the positive terms. Verification is deliberately not a term: discovery weight comes from Standing
 *   alone (§Reputation & Discovery 5), and nothing here can be bought.
 * - **Trust penalty.** Active discovery-rank penalties (`search.profiles_index.discovery_penalty`)
 *   subtract, unscaled by Standing, so a rung never shields a penalised owner.
 */

// #region Weights

/** The `search.search_weights` keys this module reads. */
export const RANKING_WEIGHT_KEYS = [
	"review_sentiment",
	"review_count",
	"workload",
	"discovery_boost",
	"penalty",
	"interest_history",
] as const;

/** One coefficient the score reads. */
export type RankingWeightKey = typeof RANKING_WEIGHT_KEYS[number];

/** The resolved coefficients — one per key, `0` for a factor that is switched off or absent. */
export type RankingWeights = Readonly<Record<RankingWeightKey, number>>;

/** The coefficients, plus the keys the table does not hold at all. */
export interface ResolvedWeights {
	weights: RankingWeights;
	/**
	 * Keys with no row. They score as switched off — the table, not this module, decides every
	 * coefficient — and are reported so a database seeded before a factor existed is diagnosable
	 * instead of silently re-weighted.
	 */
	missing: RankingWeightKey[];
}

/**
 * Resolve the live weight rows into the coefficients the score reads. An inactive row scores `0`
 * (an admin switched the factor off) and a negative or non-numeric weight is clamped to `0`, the
 * same floor `search.fn_set_weight` applies.
 */
export function resolveWeights(rows: readonly RankingWeightRow[]): ResolvedWeights {
	const byKey = new Map(rows.map((row) => [row.key, row]));
	const weightOf = (key: RankingWeightKey): number => {
		const row = byKey.get(key);
		if (!row?.is_active) return 0;
		const value = Number(row.weight);
		return Number.isFinite(value) && value > 0 ? value : 0;
	};
	return {
		weights: {
			review_sentiment: weightOf("review_sentiment"),
			review_count: weightOf("review_count"),
			workload: weightOf("workload"),
			discovery_boost: weightOf("discovery_boost"),
			penalty: weightOf("penalty"),
			interest_history: weightOf("interest_history"),
		},
		missing: RANKING_WEIGHT_KEYS.filter((key) => !byKey.has(key)),
	};
}

/** Every factor switched off — what a catalogue built without weight rows scores with. */
export const NO_WEIGHTS: RankingWeights = resolveWeights([]).weights;

// #endregion

// #region Dials

/**
 * The cold-start prior's strength, in reviews: an item's own average carries `n / (n + 5)` of its
 * sentiment and the corpus mean the rest — half the story after five reviews, ~91% after fifty.
 */
export const PRIOR_REVIEWS = 5;

/** The review count at which volume stops adding (the curve is logarithmic up to it). */
export const VOLUME_SATURATION = 50;

/** The penalty severity at which the trust penalty bites in full — `search.fn_norm`'s cap for it. */
export const PENALTY_CAP = 10;

/**
 * The prior's mean when nothing in the corpus is rated yet. It cannot change an ordering then — every
 * item shares it — so any in-range value is correct; four is the marketplace's stated bar for "clean".
 */
export const FALLBACK_PRIOR_MEAN = 4;

/** The Discovery Boost's three tests (PRODUCT_SPEC §Reputation & Discovery 2, "The Fighting Chance"). */
export const DISCOVERY_BOOST = Object.freeze({
	/** "Newer": joined within this many days … */
	newcomerDays: 90,
	/** … or "less experienced": still on this Standing rung or below (1 = New). */
	newcomerMaxLevel: 1,
	/** "Clean (even if short)": no rating average below this once there is one. */
	cleanRating: 4,
});

/** `discovery_weight_bp`'s unit: 10,000 basis points = 1.0×. */
export const BASIS_POINTS = 10_000;

// #endregion

// #region Signals

/** A reputation track: an average out of five and the number of reviews behind it. */
export interface RatingSignal {
	value: number;
	count: number;
}

/** Everything one item is scored on. Gathered by the catalogue loader; never fetched here. */
export interface RankSignals {
	/**
	 * The track that speaks for the item — a seller's delivery reviews for their profile and listings,
	 * a buyer's client reviews for theirs. Absent when it has none.
	 */
	rating?: RatingSignal;
	/**
	 * How much of the owner's Global Intensity Cap their active tickets use, 0–100 (100 = at the cap).
	 * Present only where availability is a promise the item makes — a seller's profile and services.
	 */
	utilisation?: number;
	/** The owner's earned Standing rung, 1 (New) to 5 (Elite); absent for a buyer. */
	standingLevel?: number;
	/** The rung's discovery multiplier in basis points; absent is 1.0×. */
	standingWeightBp?: number;
	/** Active discovery-rank penalty severity on the owner (`0` when clean). */
	penalty: number;
	/** Whole days since the owner joined. */
	tenureDays: number;
}

/** What a score is computed against. */
export interface RankContext {
	weights: RankingWeights;
	/** The mean the cold-start prior shrinks this item's rating toward — {@link priorMeanOf} its track. */
	priorMean: number;
}

/** One item's score, term by term. */
export interface ScoreBreakdown {
	sentiment: number;
	volume: number;
	availability: number;
	boost: number;
	/** The Standing multiplier applied to the four terms above (1 = no effect). */
	standing: number;
	/** The weighted trust penalty — zero or negative, never scaled by Standing. */
	penalty: number;
	total: number;
}

// #endregion

// #region Score

const clamp = (value: number, min: number, max: number): number =>
	Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/**
 * The corpus mean a track's prior shrinks toward: the average over every review on that track (each
 * rated item weighted by its count), or {@link FALLBACK_PRIOR_MEAN} when no item is rated.
 */
export function priorMeanOf(ratings: Iterable<RatingSignal | undefined>): number {
	let sum = 0;
	let count = 0;
	for (const rating of ratings) {
		if (!rating || rating.count <= 0) continue;
		sum += clamp(rating.value, 0, 5) * rating.count;
		count += rating.count;
	}
	return count > 0 ? sum / count : FALLBACK_PRIOR_MEAN;
}

/**
 * Whether an item earns the newcomer Discovery Boost: its owner is fully available (nothing claimed
 * against their cap), carries no active penalty and no rating below {@link DISCOVERY_BOOST.cleanRating},
 * and is either newer than {@link DISCOVERY_BOOST.newcomerDays} or still on the first rung. Only talent
 * carries a utilisation, so only a seller's profile and services can qualify.
 */
export function earnsDiscoveryBoost(signals: RankSignals): boolean {
	if (signals.utilisation !== 0) return false;
	if (signals.penalty > 0) return false;
	const rating = signals.rating;
	if (rating && rating.count > 0 && rating.value < DISCOVERY_BOOST.cleanRating) return false;
	const newer = signals.tenureDays <= DISCOVERY_BOOST.newcomerDays;
	const lessExperienced = (signals.standingLevel ?? 1) <= DISCOVERY_BOOST.newcomerMaxLevel;
	return newer || lessExperienced;
}

/** Score one item. See the module header for the model. */
export function scoreItem(signals: RankSignals, context: RankContext): ScoreBreakdown {
	const w = context.weights;
	const count = Math.max(0, signals.rating?.count ?? 0);
	const own = clamp(signals.rating?.value ?? 0, 0, 5);
	const prior = clamp(context.priorMean, 0, 5);
	const shrunk = (PRIOR_REVIEWS * prior + count * own) / (PRIOR_REVIEWS + count);

	const sentiment = w.review_sentiment * (shrunk / 5);
	const volume = w.review_count * Math.min(1, Math.log1p(count) / Math.log1p(VOLUME_SATURATION));
	const availability = signals.utilisation === undefined
		? 0
		: w.workload * (1 - clamp(signals.utilisation, 0, 100) / 100);
	const boost = earnsDiscoveryBoost(signals) ? w.discovery_boost : 0;
	const standing = clamp(signals.standingWeightBp ?? BASIS_POINTS, 0, 10 * BASIS_POINTS) /
		BASIS_POINTS;
	const penalty = -(w.penalty * clamp(signals.penalty, 0, PENALTY_CAP)) / PENALTY_CAP || 0;

	return {
		sentiment,
		volume,
		availability,
		boost,
		standing,
		penalty,
		total: standing * (sentiment + volume + availability + boost) + penalty,
	};
}

/**
 * The deterministic "recommended" order over precomputed scores: best score first, then the newer
 * item, then the id — no two items ever tie, so a sort is the same on every render (SSR/resume-safe).
 * An item with no score ranks as zero.
 */
export function byScore(
	scores: ReadonlyMap<string, number>,
): (a: Pick<ExploreItem, "id" | "createdAt">, b: Pick<ExploreItem, "id" | "createdAt">) => number {
	return (a, b) =>
		(scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) ||
		(a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) ||
		(a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// #endregion
