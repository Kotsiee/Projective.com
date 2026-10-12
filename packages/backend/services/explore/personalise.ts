import type { DiscoveryRail, ExploreItem, PersonalRails } from "@projective/types/explore";
import type { RankingWeights } from "./ranking.ts";

/**
 * personalise — the Home feed's discovery rails: the viewer's own ("Because you viewed", or "Picked
 * for you" without history; "Saved") and the shared Trending rail.
 *
 * PURE over the loaded catalogue and one viewer's {@link ViewerSignals}: the reads happen elsewhere
 * (`./viewer-signals.ts`, under the viewer's own token), so this module decides only WHAT to show and
 * is testable without a database. Every rail is ranked by the catalogue's quality score
 * (`./ranking.ts`) plus `interest_history` × how closely the item matches the viewer — relevance
 * picks the candidates, quality orders them, and the coefficient comes from `search.search_weights`
 * like every other.
 *
 * A rail that cannot be filled honestly is `null`, never padded: three is the floor, and a heading
 * only ever claims what filled it ({@link DiscoveryRail.kind}).
 */

// #region Dials
/** The most items one rail shows. */
export const RAIL_MAX = 12;

/** The fewest items a rail is worth showing — below it, the rail is left out. */
export const RAIL_MIN = 3;

/** "New on Projective" means published in the last this-many days. */
export const NEW_WINDOW_DAYS = 30;

/** Affinity's half-life — the same as `search.record_view`, which decays before each bump. */
export const AFFINITY_HALF_LIFE_DAYS = 14;

/** How many of the latest views may anchor "Because you viewed", newest first. */
const MAX_ANCHORS = 3;

const DAY_MS = 86_400_000;
// #endregion

// #region Inputs
/** The slice of the catalogue the rails read — `items` already in recommended order. */
export interface RailCatalog {
	items: readonly ExploreItem[];
	byId: ReadonlyMap<string, ExploreItem>;
	scoreById: ReadonlyMap<string, number>;
	/** Trending item ids, most active first (past the three-person floor). */
	trending: readonly string[];
}

/** One signed-in viewer's signals, resolved to live catalogue item ids. */
export interface ViewerSignals {
	/** What the viewer opened, newest first. */
	viewed: string[];
	/** What the viewer saved, newest first. */
	saved: string[];
	/** Topic → affinity, already decayed to now ({@link decayedAffinity}). */
	affinity: ReadonlyMap<string, number>;
	/** Stated interests and seller skills, as topics ({@link normaliseTopic}). */
	interests: string[];
	/** The `@handle`s whose items are the viewer's own — never recommended back to them. */
	own: ReadonlySet<string>;
	/**
	 * Whether the viewer takes work (a freelancer, or acting as a team). "Picked for you" then means
	 * briefs to apply to — the spec's Recommender Logic — and otherwise things to hire or buy.
	 */
	seller: boolean;
}

/** No personal rails — a guest's, or a viewer whose signals could not be read. */
export const NO_PERSONAL_RAILS: PersonalRails = Object.freeze({ viewed: null, saved: null });
// #endregion

// #region Topics
/** A topic as compared: lowercase words, separators (`-`, `_`, `/`) as spaces, single-spaced. */
export function normaliseTopic(raw: string): string {
	return raw.toLowerCase().replace(/[-_/#]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The topics an item is about — its skill labels, plus its listing category or article topic. These
 * are what `search.record_view` leans a viewer's affinity toward when they open the item.
 */
export function topicsOf(item: ExploreItem): string[] {
	const out = new Set(item.skills.map((s) => normaliseTopic(s.label)));
	if ((item.type === "services" || item.type === "products") && item.category) {
		out.add(normaliseTopic(item.category));
	}
	if (item.type === "articles" && item.topic) out.add(normaliseTopic(item.topic));
	out.delete("");
	return [...out];
}

/** Whether a viewer's topic names an item's: equal, or one is a whole-word phrase inside the other. */
export function topicMatches(viewerTopic: string, itemTopic: string): boolean {
	if (viewerTopic === itemTopic) return true;
	if (viewerTopic.length < 3 || itemTopic.length < 3) return false;
	return ` ${itemTopic} `.includes(` ${viewerTopic} `) ||
		` ${viewerTopic} `.includes(` ${itemTopic} `);
}

/**
 * How alike two items are: the Jaccard overlap of their topics and skill families, 0–1. The family
 * (`design`, `motion` …) gives two items in one craft a floor of likeness even when their labels
 * differ; a shared label lifts them well above it.
 */
export function similarity(a: ExploreItem, b: ExploreItem): number {
	const tags = (it: ExploreItem) =>
		new Set([...topicsOf(it), ...it.skills.map((s) => `family:${s.category}`)]);
	const left = tags(a);
	const right = tags(b);
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const tag of left) if (right.has(tag)) shared++;
	return shared / (left.size + right.size - shared);
}

/** An affinity score stored at `updatedAt`, decayed to `now` with the {@link AFFINITY_HALF_LIFE_DAYS}. */
export function decayedAffinity(score: number, updatedAt: string | null, now: number): number {
	const at = updatedAt ? Date.parse(updatedAt) : now;
	const ageDays = Number.isFinite(at) ? Math.max(0, (now - at) / DAY_MS) : 0;
	return Math.max(0, score) * 0.5 ** (ageDays / AFFINITY_HALF_LIFE_DAYS);
}
// #endregion

// #region Rails
/** What "alike" means across types: a service resembles services, a freelancer resembles talent. */
const FAMILY: Record<ExploreItem["type"], string> = {
	services: "services",
	products: "products",
	projects: "projects",
	articles: "articles",
	freelancers: "talent",
	teams: "talent",
	users: "buyers",
	businesses: "buyers",
};

/** What a "New on Projective" rail may hold: things a reader can hire, buy or join. */
const MARKETPLACE = new Set<ExploreItem["type"]>([
	"services",
	"products",
	"projects",
	"freelancers",
	"teams",
]);

/** "Picked for you" for someone who takes work: the briefs that match their demonstrated skills. */
const SELLER_PICKS = new Set<ExploreItem["type"]>(["projects"]);

/** "Picked for you" for someone who hires or buys: services, products and the people behind them. */
const BUYER_PICKS = new Set<ExploreItem["type"]>(["services", "products", "freelancers", "teams"]);

const isOwn = (item: ExploreItem, viewer: ViewerSignals) => viewer.own.has(item.owner.handle);

/** Order candidates by quality + `interest_history` × relevance; ties keep the catalogue's order. */
function ranked(
	candidates: Array<{ item: ExploreItem; relevance: number }>,
	catalog: RailCatalog,
	weights: RankingWeights,
): ExploreItem[] {
	const rank = (c: { item: ExploreItem; relevance: number }) =>
		(catalog.scoreById.get(c.item.id) ?? 0) + weights.interest_history * c.relevance;
	return candidates
		.sort((a, b) => rank(b) - rank(a))
		.slice(0, RAIL_MAX)
		.map((c) => c.item);
}

/**
 * "Because you viewed …": the newest view that still has three or more relatives in its family —
 * excluding everything the viewer has already opened and anything of their own.
 */
function becauseViewed(
	catalog: RailCatalog,
	viewer: ViewerSignals,
	weights: RankingWeights,
): DiscoveryRail | null {
	const opened = new Set(viewer.viewed);
	for (const anchorId of viewer.viewed.slice(0, MAX_ANCHORS)) {
		const anchor = catalog.byId.get(anchorId);
		if (!anchor || isOwn(anchor, viewer)) continue;
		const candidates = catalog.items
			.filter((it) =>
				FAMILY[it.type] === FAMILY[anchor.type] && !opened.has(it.id) && !isOwn(it, viewer)
			)
			.map((item) => ({ item, relevance: similarity(anchor, item) }))
			.filter((c) => c.relevance > 0);
		if (candidates.length < RAIL_MIN) continue;
		return {
			kind: "because_viewed",
			anchor: { id: anchor.id, title: anchor.title },
			items: ranked(candidates, catalog, weights),
		};
	}
	return null;
}

/**
 * "Picked for you" — the fallback without usable history: items matching the viewer's recent topics
 * (their decayed affinity) or, with none, their stated interests and skills. A seller is shown
 * briefs; anyone else, what they could hire or buy.
 */
function pickedForYou(
	catalog: RailCatalog,
	viewer: ViewerSignals,
	weights: RankingWeights,
): DiscoveryRail | null {
	const fromActivity = [...viewer.affinity].filter(([, weight]) => weight > 0);
	const basis = fromActivity.length > 0 ? "activity" : "interests";
	const topics = basis === "activity"
		? fromActivity
		: viewer.interests.map((topic): [string, number] => [topic, 1]);
	const total = topics.reduce((sum, [, weight]) => sum + weight, 0);
	if (total <= 0) return null;

	const opened = new Set(viewer.viewed);
	const picks = viewer.seller ? SELLER_PICKS : BUYER_PICKS;
	const candidates = catalog.items
		.filter((it) => picks.has(it.type) && !opened.has(it.id) && !isOwn(it, viewer))
		.map((item) => {
			const own = topicsOf(item);
			const matched = topics.reduce(
				(sum, [topic, weight]) => sum + (own.some((t) => topicMatches(topic, t)) ? weight : 0),
				0,
			);
			return { item, relevance: matched / total };
		})
		.filter((c) => c.relevance > 0);
	if (candidates.length < RAIL_MIN) return null;
	return { kind: "for_you", basis, items: ranked(candidates, catalog, weights) };
}

/** What the viewer saved, newest first — whatever is still published and not their own. */
function savedRail(catalog: RailCatalog, viewer: ViewerSignals): DiscoveryRail | null {
	const items = viewer.saved
		.map((id) => catalog.byId.get(id))
		.filter((it): it is ExploreItem => !!it && !isOwn(it, viewer))
		.slice(0, RAIL_MAX);
	return items.length > 0 ? { kind: "saved", items } : null;
}

/**
 * The viewer's own rails: "Because you viewed" falling back to "Picked for you", and "Saved". A rail
 * with nothing honest to show is `null`.
 */
export function personalRails(
	catalog: RailCatalog,
	viewer: ViewerSignals,
	weights: RankingWeights,
): PersonalRails {
	return {
		viewed: becauseViewed(catalog, viewer, weights) ?? pickedForYou(catalog, viewer, weights),
		saved: savedRail(catalog, viewer),
	};
}

/**
 * The shared Trending rail: what three or more people opened or saved this week — or, when fewer than
 * {@link RAIL_MIN} such items are still published (or `quiet` simulates a platform with no activity),
 * the best of what was published in the last {@link NEW_WINDOW_DAYS} days, as "New on Projective".
 * `null` when neither can fill a rail.
 */
export function trendingRail(
	catalog: RailCatalog,
	now: number,
	quiet = false,
): DiscoveryRail | null {
	if (!quiet) {
		const items = catalog.trending
			.map((id) => catalog.byId.get(id))
			.filter((it): it is ExploreItem => !!it)
			.slice(0, RAIL_MAX);
		if (items.length >= RAIL_MIN) return { kind: "trending", items };
	}
	const since = now - NEW_WINDOW_DAYS * DAY_MS;
	const fresh = catalog.items
		.filter((it) => MARKETPLACE.has(it.type) && Date.parse(it.createdAt) >= since)
		.slice(0, RAIL_MAX);
	return fresh.length >= RAIL_MIN ? { kind: "new", items: fresh } : null;
}
// #endregion
