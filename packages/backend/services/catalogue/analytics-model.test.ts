import { assertEquals } from "@std/assert";
import {
	CatalogueAnalyticsSchema,
	lastRolledUpDay,
	type MetricTile,
	RATE_MIN_DENOMINATOR,
} from "@projective/types/catalogue";
import {
	type AnalyticsInputs,
	buildAnalytics,
	type MinorConverter,
	type RollupRow,
	windowsFor,
} from "./analytics-model.ts";
import type { ScopedListing } from "./listing-scope.ts";

/**
 * analytics-model_test — the arithmetic behind the Analytics read: the sufficiency thresholds
 * (Decision #217(k)), the currency rule, the window that never includes today, and what each scope
 * shows.
 */

// #region Harness
const ASOF = "2026-10-13";

function listing(n: number, fields: Partial<ScopedListing> = {}): ScopedListing {
	return {
		id: `00000000-0000-4000-8000-00000000000${n}`,
		slug: `svc-listing${n}a`,
		title: `Listing ${n}`,
		kind: "service",
		model: "one_off",
		currency: "USD",
		createCategory: "create",
		blueprintId: `bp-${n}`,
		productId: null,
		...fields,
	};
}

const A = listing(1);
const B = listing(2, { model: "session" });

function rollup(
	l: ScopedListing,
	day: string,
	metric: string,
	value: number,
	dimensions: Record<string, unknown> = {},
	sample = value,
): RollupRow {
	return { day, metric, subject_id: l.id, dimensions, value, sample_count: sample };
}

function inputs(rows: RollupRow[], extra: Partial<AnalyticsInputs> = {}): AnalyticsInputs {
	return {
		scope: { kind: "catalogue", filter: "all" },
		period: "30d",
		listings: [A, B],
		rows,
		windows: windowsFor("30d", ASOF),
		standing: { current: 3, previous: 2 },
		timezone: "Europe/London",
		display: "GBP",
		convert: null,
		...extra,
	};
}

function tile(tiles: readonly MetricTile[], key: MetricTile["key"]): MetricTile {
	const found = tiles.find((t) => t.key === key);
	if (!found) throw new Error(`no ${key} tile`);
	return found;
}
// #endregion

// #region Window
Deno.test("the window ends on the last rolled-up day, never today", () => {
	assertEquals(lastRolledUpDay(new Date("2026-10-14T02:29:00Z")), "2026-10-12");
	assertEquals(lastRolledUpDay(new Date("2026-10-14T02:30:00Z")), "2026-10-13");
	assertEquals(lastRolledUpDay(new Date("2026-10-14T23:59:00Z")), "2026-10-13");
	const w = windowsFor("7d", ASOF);
	assertEquals(w.current, { from: "2026-10-07", through: ASOF });
	assertEquals(w.previous, { from: "2026-09-30", through: "2026-10-06" });
	const out = buildAnalytics(inputs([], { period: "7d", windows: w }));
	assertEquals(out.asOf, ASOF);
	assertEquals(out.window.label, "Oct 7 – Oct 13 · today not included");
});

Deno.test("a row from today (outside the window) is never counted", () => {
	const out = buildAnalytics(inputs([rollup(A, "2026-10-14", "listing.orders", 9)]));
	assertEquals(tile(out.tiles, "orders").value, 0);
});
// #endregion

// #region Thresholds
Deno.test("conversion is withheld below the rate denominator and shown at it", () => {
	const below = buildAnalytics(inputs([
		rollup(A, ASOF, "listing.views", RATE_MIN_DENOMINATOR - 1),
		rollup(A, ASOF, "listing.orders", 3),
	]));
	const conv = tile(below.tiles, "conversion");
	assertEquals([conv.value, conv.sufficient, conv.display], [null, false, "Not enough data yet"]);

	const at = buildAnalytics(inputs([
		rollup(A, ASOF, "listing.views", RATE_MIN_DENOMINATOR),
		rollup(A, ASOF, "listing.orders", 3),
	]));
	const shown = tile(at.tiles, "conversion");
	assertEquals([shown.value, shown.sufficient, shown.display], [0.15, true, "15.0%"]);
});

Deno.test("churn and funnel rates honour the same threshold", () => {
	const out = buildAnalytics(inputs([
		rollup(A, ASOF, "listing.impressions", 100),
		rollup(A, ASOF, "listing.views", 30),
		rollup(A, ASOF, "listing.checkout_starts", 6),
		rollup(A, ASOF, "listing.orders", 3),
		rollup(A, ASOF, "listing.cancellations", 1),
	]));
	assertEquals(tile(out.tiles, "churn").value, null);
	assertEquals(out.funnel.map((s) => [s.key, s.count, s.rate]), [
		["impressions", 100, null],
		["views", 30, 0.3],
		["checkout_starts", 6, 0.2],
		["orders", 3, null],
	]);
});

Deno.test("keywords under five sessions are never listed; clicks join by query", () => {
	const out = buildAnalytics(inputs([
		rollup(A, ASOF, "listing.query_impressions", 40, { q: "logo design" }, 6),
		rollup(A, ASOF, "listing.query_clicks", 4, { q: "logo design" }, 1),
		rollup(A, ASOF, "listing.query_impressions", 9, { q: "rare query" }, 4),
	]));
	assertEquals(out.keywords, [
		{ query: "logo design", impressions: 40, sessions: 6, clicks: 4, ctr: 0.1 },
	]);
});

Deno.test("deltas compare with the previous window and state the direction", () => {
	const prevDay = windowsFor("30d", ASOF).previous.through;
	const out = buildAnalytics(inputs([
		rollup(A, ASOF, "listing.orders", 6),
		rollup(A, prevDay, "listing.orders", 4),
	]));
	assertEquals(tile(out.tiles, "orders").delta, { change: 50, direction: "up" });
	assertEquals(tile(out.tiles, "standing_impact").delta, { change: 50, direction: "up" });
	assertEquals(tile(out.tiles, "churn").delta, null);
});

Deno.test("Standing impact with no CREATE category in scope is not a fabricated zero", () => {
	const t = tile(buildAnalytics(inputs([], { standing: null })).tiles, "standing_impact");
	assertEquals([t.value, t.sufficient, t.display], [null, false, "No CREATE category"]);
});
// #endregion

// #region Currency
Deno.test("gross in one currency stays in it, whatever the display currency", () => {
	const out = buildAnalytics(inputs([
		rollup(A, ASOF, "listing.gross_minor", 12_000, { currency: "EUR" }, 1),
		rollup(B, ASOF, "listing.gross_minor", 3_000, { currency: "eur" }, 1),
	]));
	assertEquals(out.currency, "EUR");
	assertEquals(tile(out.tiles, "gross").value, 150);
});

Deno.test("mixed currencies convert into the display currency; an unpriced one counts as nothing", () => {
	const convert: MinorConverter = (minor, from, to) =>
		to === "GBP" && from === "USD"
			? Math.round(minor * 0.8)
			: to === "GBP" && from === "EUR"
			? Math.round(minor * 0.9)
			: null;
	const out = buildAnalytics(inputs([
		rollup(A, ASOF, "listing.gross_minor", 10_000, { currency: "USD" }, 1),
		rollup(B, ASOF, "listing.gross_minor", 10_000, { currency: "EUR" }, 1),
		rollup(B, ASOF, "listing.gross_minor", 10_000, { currency: "JPY" }, 1),
	], { convert }));
	assertEquals(out.currency, "GBP");
	assertEquals(tile(out.tiles, "gross").value, 170);
	assertEquals(out.revenue.at(-1), { date: ASOF, value: 170 });
});
// #endregion

// #region Shape
Deno.test("long windows bucket the revenue weekly; short ones daily", () => {
	const daily = buildAnalytics(inputs([]));
	assertEquals([daily.bucket, daily.revenue.length], ["day", 30]);
	const weekly = buildAnalytics(inputs([], { period: "90d", windows: windowsFor("90d", ASOF) }));
	assertEquals([weekly.bucket, weekly.revenue.length], ["week", 13]);
	const year = buildAnalytics(inputs([], { period: "12m", windows: windowsFor("12m", ASOF) }));
	assertEquals([year.bucket, year.revenue.length, year.revenue[0].date], [
		"week",
		53,
		"2025-10-14",
	]);
});

Deno.test("the heatmap appears only for a scope that sells sessions", () => {
	const slot = rollup(B, ASOF, "listing.booking_slot", 2, { dow: 2, hour: 10 });
	const withSessions = buildAnalytics(inputs([slot]));
	assertEquals(withSessions.heatmap.length, 168);
	assertEquals(withSessions.heatmap.find((c) => c.dow === 2 && c.hour === 10)?.value, 2);
	assertEquals(buildAnalytics(inputs([slot], { listings: [A] })).heatmap, []);
});

Deno.test("top listings are console-only, ranked by gross, and ignore rows outside the scope", () => {
	const rows = [
		rollup(A, ASOF, "listing.gross_minor", 5_000, { currency: "USD" }, 1),
		rollup(B, ASOF, "listing.gross_minor", 9_000, { currency: "USD" }, 1),
		rollup(listing(3), ASOF, "listing.gross_minor", 99_000, { currency: "USD" }, 1),
	];
	const whole = buildAnalytics(inputs(rows));
	assertEquals(whole.topListings.map((t) => [t.id, t.gross]), [[B.slug, 90], [A.slug, 50]]);
	assertEquals(tile(whole.tiles, "gross").value, 140);
	const item = buildAnalytics(inputs(rows, {
		scope: { kind: "listing", listingId: A.slug },
		listings: [A],
	}));
	assertEquals(item.topListings, []);
	assertEquals(tile(item.tiles, "gross").value, 50);
});

Deno.test("every read parses against the contract", () => {
	CatalogueAnalyticsSchema.parse(buildAnalytics(inputs([
		rollup(A, ASOF, "listing.views", 25),
		rollup(A, ASOF, "listing.orders", 2),
		rollup(A, ASOF, "listing.gross_minor", 2_000, { currency: "USD" }, 2),
	])));
});
// #endregion
