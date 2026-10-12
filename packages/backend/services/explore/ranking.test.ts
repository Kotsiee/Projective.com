import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	byScore,
	DISCOVERY_BOOST,
	earnsDiscoveryBoost,
	FALLBACK_PRIOR_MEAN,
	NO_WEIGHTS,
	PENALTY_CAP,
	priorMeanOf,
	RANKING_WEIGHT_KEYS,
	type RankingWeights,
	type RankSignals,
	resolveWeights,
	scoreItem,
} from "./ranking.ts";

/**
 * The discovery score's contract with PRODUCT_SPEC §Reputation & Discovery: a cold-start prior, the
 * Workload-Aware Discovery Loop, the newcomer Discovery Boost, Standing's multiplier and the trust
 * penalty — each pinned as a behaviour a reader of the spec would recognise, against the seeded
 * coefficients rather than numbers invented for the test.
 */

// #region Fixtures
const SEED = new URL(
	"../../../../supabase/migrations/00005050_seed_reference_data.sql",
	import.meta.url,
);

/** The `search.search_weights` rows exactly as the reference seed writes them. */
function seededRows(): Array<{ key: string; weight: number; is_active: boolean }> {
	const sql = Deno.readTextFileSync(SEED);
	const block = sql.slice(sql.indexOf("INSERT INTO search.search_weights"));
	const rows = [
		...block.slice(0, block.indexOf(";")).matchAll(
			/\(\s*'([a-z_]+)',\s*'[^']*',\s*'[^']*',\s*'[a-z]+',\s*([\d.]+)\s*\)/g,
		),
	];
	return rows.map((m) => ({ key: m[1], weight: Number(m[2]), is_active: true }));
}

const WEIGHTS: RankingWeights = resolveWeights(seededRows()).weights;
const PRIOR = 4.5;

/** A fully available, clean, long-standing first-rung seller with no reviews. */
function seller(extra: Partial<RankSignals> = {}): RankSignals {
	return { utilisation: 0, standingLevel: 2, penalty: 0, tenureDays: 400, ...extra };
}

const total = (signals: RankSignals, weights = WEIGHTS) =>
	scoreItem(signals, { weights, priorMean: PRIOR }).total;
// #endregion

Deno.test("every coefficient the score reads is seeded, so a reset database reports none missing", () => {
	const { missing } = resolveWeights(seededRows());
	assertEquals(missing, []);
	for (const key of RANKING_WEIGHT_KEYS) assert(WEIGHTS[key] > 0, `${key} seeds a positive weight`);
});

Deno.test("an inactive, negative or absent weight scores as switched off; absent keys are reported", () => {
	const { weights, missing } = resolveWeights([
		{ key: "review_sentiment", weight: "1.75", is_active: true },
		{ key: "review_count", weight: 1, is_active: false },
		{ key: "workload", weight: -2, is_active: true },
	]);
	assertEquals(weights.review_sentiment, 1.75);
	assertEquals(weights.review_count, 0);
	assertEquals(weights.workload, 0);
	assertEquals(missing, ["discovery_boost", "penalty", "interest_history"]);
	assertEquals(total(seller({ rating: { value: 5, count: 40 } }), NO_WEIGHTS), 0);
});

Deno.test("the cold-start prior: an unreviewed newcomer starts at the corpus mean, not at zero", () => {
	const unreviewed = scoreItem(seller(), { weights: WEIGHTS, priorMean: PRIOR });
	assertAlmostEquals(unreviewed.sentiment, WEIGHTS.review_sentiment * PRIOR / 5);
	const poorlyRated = scoreItem(seller({ rating: { value: 2, count: 20 } }), {
		weights: WEIGHTS,
		priorMean: PRIOR,
	});
	assert(unreviewed.sentiment > poorlyRated.sentiment);
});

Deno.test("the cold-start prior: one five-star review does not outrank fifty 4.9s", () => {
	const one = seller({ rating: { value: 5, count: 1 } });
	const fifty = seller({ rating: { value: 4.9, count: 50 } });
	assert(total(fifty) > total(one));
});

Deno.test("review volume saturates — five hundred reviews add no more than fifty", () => {
	const fifty = scoreItem(seller({ rating: { value: 4.8, count: 50 } }), {
		weights: WEIGHTS,
		priorMean: PRIOR,
	});
	const many = scoreItem(seller({ rating: { value: 4.8, count: 500 } }), {
		weights: WEIGHTS,
		priorMean: PRIOR,
	});
	assertAlmostEquals(fifty.volume, many.volume);
	assertAlmostEquals(fifty.volume, WEIGHTS.review_count);
});

Deno.test("the Discovery Loop: a top seller at their Global Intensity Cap ranks lower until they free up", () => {
	const star = { rating: { value: 4.95, count: 80 }, standingLevel: 5, standingWeightBp: 12_000 };
	const atCap = scoreItem(seller({ ...star, utilisation: 100 }), {
		weights: WEIGHTS,
		priorMean: PRIOR,
	});
	const free = scoreItem(seller({ ...star, utilisation: 0 }), {
		weights: WEIGHTS,
		priorMean: PRIOR,
	});
	assertEquals(atCap.availability, 0);
	assertAlmostEquals(free.total - atCap.total, 1.2 * WEIGHTS.workload);
	assertEquals(
		scoreItem(seller({ utilisation: 250 }), { weights: WEIGHTS, priorMean: PRIOR })
			.availability,
		0,
	);
});

Deno.test("the Fighting Chance: a fully available newcomer with a clean record can outrank a busy veteran", () => {
	const newcomer = seller({ tenureDays: 12, standingLevel: 1 });
	const veteran = seller({
		rating: { value: 4.9, count: 60 },
		standingLevel: 3,
		standingWeightBp: 11_000,
		utilisation: 100,
	});
	assert(earnsDiscoveryBoost(newcomer));
	assert(total(newcomer) > total(veteran));
});

Deno.test("the Discovery Boost needs all three: newer or first-rung, fully available, clean", () => {
	const fresh = { tenureDays: 30, standingLevel: 2 };
	assert(earnsDiscoveryBoost(seller(fresh)));
	assert(
		earnsDiscoveryBoost(seller({ tenureDays: 900, standingLevel: 1 })),
		"first rung, long tenure",
	);
	assert(
		earnsDiscoveryBoost(seller({ ...fresh, rating: { value: 5, count: 1 } })),
		"short but clean",
	);
	assert(
		!earnsDiscoveryBoost(seller({ tenureDays: 400, standingLevel: 3 })),
		"neither new nor first-rung",
	);
	assert(!earnsDiscoveryBoost(seller({ ...fresh, utilisation: 10 })), "not fully available");
	assert(!earnsDiscoveryBoost(seller({ ...fresh, penalty: 1 })), "an active penalty");
	assert(
		!earnsDiscoveryBoost(
			seller({ ...fresh, rating: { value: DISCOVERY_BOOST.cleanRating - 0.5, count: 3 } }),
		),
		"a rating under the clean bar",
	);
	assert(
		!earnsDiscoveryBoost({ penalty: 0, tenureDays: 1, standingLevel: 1 }),
		"no utilisation — a buyer's or a product's — never boosts",
	);
});

Deno.test("Standing scales the earned terms by its rung multiplier and never shields a penalty", () => {
	const base = { rating: { value: 4.7, count: 30 }, utilisation: 40, penalty: 6 };
	const l1 = scoreItem(seller({ ...base, standingWeightBp: 10_000 }), {
		weights: WEIGHTS,
		priorMean: PRIOR,
	});
	const l5 = scoreItem(seller({ ...base, standingWeightBp: 12_000 }), {
		weights: WEIGHTS,
		priorMean: PRIOR,
	});
	assertEquals(l5.standing, 1.2);
	assertAlmostEquals(l5.penalty, l1.penalty);
	const earned = l1.sentiment + l1.volume + l1.availability + l1.boost;
	assertAlmostEquals(l5.total - l1.total, 0.2 * earned);
});

Deno.test("the trust penalty de-ranks in proportion to severity, capped at full strength", () => {
	const clean = total(seller({ rating: { value: 4.8, count: 25 } }));
	const half = total(seller({ rating: { value: 4.8, count: 25 }, penalty: PENALTY_CAP / 2 }));
	const full = total(seller({ rating: { value: 4.8, count: 25 }, penalty: PENALTY_CAP }));
	const beyond = total(seller({ rating: { value: 4.8, count: 25 }, penalty: PENALTY_CAP * 4 }));
	assertAlmostEquals(clean - half, WEIGHTS.penalty / 2);
	assertAlmostEquals(clean - full, WEIGHTS.penalty);
	assertAlmostEquals(full, beyond);
});

Deno.test("the prior mean is the review-weighted corpus mean, with a fallback when nothing is rated", () => {
	assertAlmostEquals(
		priorMeanOf([{ value: 5, count: 3 }, { value: 4, count: 1 }, undefined]),
		4.75,
	);
	assertEquals(priorMeanOf([undefined, { value: 2, count: 0 }]), FALLBACK_PRIOR_MEAN);
});

Deno.test("byScore orders best first, then newest, then by id — never a tie", () => {
	const scores = new Map([["a", 2], ["b", 3], ["c", 2], ["d", 2]]);
	const items = [
		{ id: "d", createdAt: "2026-09-01" },
		{ id: "c", createdAt: "2026-10-01" },
		{ id: "a", createdAt: "2026-10-01" },
		{ id: "b", createdAt: "2026-01-01" },
		{ id: "z", createdAt: "2026-12-01" },
	];
	assertEquals([...items].sort(byScore(scores)).map((it) => it.id), ["b", "a", "c", "d", "z"]);
});
