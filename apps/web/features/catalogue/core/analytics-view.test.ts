import { assertEquals } from "@std/assert";
import type {
	CatalogueAnalytics,
	FunnelStep,
	HeatCell,
	MetricTile,
} from "@projective/types/catalogue";
import { KEYWORD_MIN_SESSIONS, RATE_MIN_DENOMINATOR } from "@projective/types/catalogue";
import { fixtureOverview } from "@server/services/catalogue/analytics-fixtures.ts";
import { headlineOf } from "@server/services/catalogue/analytics-model.ts";
import {
	analyticsQuery,
	asOfCaption,
	consoleAnalyticsTarget,
	deltaLabel,
	funnelSentence,
	NOT_ENOUGH_DATA,
	percentLabel,
	toChurn,
	toFunnel,
	toHeatmap,
	toKeywords,
	toRevenue,
	toTiles,
	toTopListings,
} from "./analytics-view.ts";

/**
 * analytics-view_test — the analytics canvas's pure view-model: tiles never print a figure below its
 * threshold, the funnel is not drawn from a base too small to mean anything, the booking heatmap is a
 * full Monday-first grid, and the header's rollups print what the tiles print.
 */

// #region Harness
function tileOf(key: MetricTile["key"], fields: Partial<MetricTile> = {}): MetricTile {
	return {
		key,
		label: key,
		value: 1,
		display: "1",
		delta: null,
		sufficient: true,
		...fields,
	};
}

function analytics(fields: Partial<CatalogueAnalytics> = {}): CatalogueAnalytics {
	return {
		scope: { kind: "catalogue", filter: "all" },
		period: "30d",
		currency: "USD",
		timezone: "Europe/London",
		window: { from: "2026-09-14", through: "2026-10-13", label: "Sep 14 – Oct 13" },
		tiles: [],
		revenue: [],
		bucket: "day",
		funnel: [],
		heatmap: [],
		keywords: [],
		topListings: [],
		asOf: "2026-10-13",
		...fields,
	};
}
// #endregion

// #region toTiles
Deno.test("toTiles — gross, orders, conversion, standing impact in that order; churn is not a tile", () => {
	const a = analytics({
		tiles: [
			tileOf("churn"),
			tileOf("standing_impact"),
			tileOf("conversion"),
			tileOf("orders"),
			tileOf("gross"),
		],
	});
	assertEquals(toTiles(a).map((t) => t.key), ["gross", "orders", "conversion", "standing_impact"]);
});

Deno.test("toTiles — prints the server's figure and a signed delta", () => {
	const [gross] = toTiles(analytics({
		tiles: [tileOf("gross", {
			value: 4820,
			display: "$4,820",
			delta: { change: 12.4, direction: "up" },
		})],
	}));
	assertEquals(gross.value, "$4,820");
	assertEquals(gross.delta, "+12.4%");
	assertEquals(gross.deltaSpoken, "up 12.4% on the previous 30 days");
	assertEquals(gross.note, null);
});

Deno.test("toTiles — an insufficient rate says so, explains the threshold, and has no delta", () => {
	const [conversion] = toTiles(analytics({
		tiles: [tileOf("conversion", {
			value: null,
			display: "Not enough data yet",
			delta: { change: 50, direction: "up" },
			sufficient: false,
		})],
	}));
	assertEquals(conversion.value, NOT_ENOUGH_DATA);
	assertEquals(conversion.delta, null);
	assertEquals(conversion.sufficient, false);
	assertEquals(conversion.note?.includes(`${RATE_MIN_DENOMINATOR} views`), true);
});

Deno.test("toTiles — a figure flagged insufficient is never printed, even with a value", () => {
	const [orders] = toTiles(analytics({
		tiles: [tileOf("orders", { value: 0, display: "0", sufficient: false })],
	}));
	assertEquals(orders.value, NOT_ENOUGH_DATA);
});

Deno.test("deltaLabel — a true minus, no sign on level, nothing without a base", () => {
	assertEquals(deltaLabel(-3), "−3%");
	assertEquals(deltaLabel(0), "0%");
	assertEquals(deltaLabel(null), null);
	assertEquals(deltaLabel(Number.NaN), null);
});

Deno.test("toChurn — a sentence, or the threshold when there are too few orders", () => {
	const ok = toChurn(analytics({
		tiles: [
			tileOf("churn", { value: 0.024, display: "2.4%", delta: { change: -1, direction: "down" } }),
		],
	}));
	assertEquals(ok, {
		text: "2.4% of orders were cancelled or refunded",
		delta: "−1%",
		sufficient: true,
		note: null,
	});
	const thin = toChurn(analytics({
		tiles: [tileOf("churn", { value: null, display: NOT_ENOUGH_DATA, sufficient: false })],
	}));
	assertEquals(thin?.sufficient, false);
	assertEquals(thin?.text, NOT_ENOUGH_DATA);
	assertEquals(thin?.note?.includes(`${RATE_MIN_DENOMINATOR} orders`), true);
	assertEquals(toChurn(analytics()), null);
});
// #endregion

// #region toFunnel
function funnel(counts: [number, number, number, number]): FunnelStep[] {
	const labels = ["Impressions", "Views", "Checkout starts", "Orders"];
	const keys = ["impressions", "views", "checkout_starts", "orders"] as const;
	return counts.map((count, i) => ({ key: keys[i], label: labels[i], count, rate: null }));
}

Deno.test("toFunnel — the steps in order, drawn once the first clears the threshold", () => {
	const view = toFunnel(funnel([RATE_MIN_DENOMINATOR, 8, 2, 1]));
	assertEquals(view.steps.map((s) => s.value), [RATE_MIN_DENOMINATOR, 8, 2, 1]);
	assertEquals(view.sufficient, true);
	assertEquals(view.any, true);
});

Deno.test("toFunnel — a thin funnel is printed as counts, not drawn", () => {
	const view = toFunnel(funnel([RATE_MIN_DENOMINATOR - 1, 3, 0, 0]));
	assertEquals(view.sufficient, false);
	assertEquals(
		funnelSentence(view),
		`${RATE_MIN_DENOMINATOR - 1} impressions · 3 views · 0 checkout starts · 0 orders`,
	);
	assertEquals(toFunnel(funnel([0, 0, 0, 0])).any, false);
});

Deno.test("toFunnel — a negative count is drawn as nothing", () => {
	assertEquals(toFunnel(funnel([-4, 0, 0, 0])).steps[0].value, 0);
});
// #endregion

// #region toHeatmap
Deno.test("toHeatmap — a full Monday-first 7 × 24 grid from sparse cells", () => {
	const view = toHeatmap([
		{ dow: 0, hour: 9, value: 2 },
		{ dow: 1, hour: 14, value: 5 },
	]);
	assertEquals(view.rows, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
	assertEquals(view.columns.length, 24);
	assertEquals(view.columns[9], "09:00");
	assertEquals(view.values.length, 7);
	assertEquals(view.values.every((r) => r.length === 24), true);
	assertEquals(view.values[0][14], 5);
	assertEquals(view.values[6][9], 2);
	assertEquals(view.total, 7);
	assertEquals(view.peak, { day: "Mon", hour: "14:00", value: 5 });
});

Deno.test("toHeatmap — duplicates add up; out-of-range and negative cells are dropped", () => {
	const cells: HeatCell[] = [
		{ dow: 3, hour: 10, value: 1 },
		{ dow: 3, hour: 10, value: 2 },
		{ dow: 7, hour: 10, value: 9 },
		{ dow: 2, hour: 24, value: 9 },
		{ dow: 2, hour: 5, value: -3 },
	];
	const view = toHeatmap(cells);
	assertEquals(view.values[2][10], 3);
	assertEquals(view.total, 3);
});

Deno.test("toHeatmap — nothing booked has no peak", () => {
	const view = toHeatmap([]);
	assertEquals(view.total, 0);
	assertEquals(view.peak, null);
});
// #endregion

// #region Tables, series, captions
Deno.test("toKeywords — CTR below its threshold is a dash, never 0%", () => {
	const rows = toKeywords([
		{
			query: "logo design",
			impressions: 1204,
			sessions: KEYWORD_MIN_SESSIONS,
			clicks: 40,
			ctr: 40 / 1204,
		},
		{ query: "ui kit", impressions: 12, sessions: KEYWORD_MIN_SESSIONS, clicks: 0, ctr: null },
	]);
	assertEquals(rows[0], {
		query: "logo design",
		impressions: "1,204",
		ctr: "3.3%",
		ctrSufficient: true,
	});
	assertEquals(rows[1].ctr, "—");
	assertEquals(rows[1].ctrSufficient, false);
});

Deno.test("toTopListings — each row links to its own Analytics tab", () => {
	const [row] = toTopListings(
		[{
			id: "svc-abc",
			title: "Brand sprint",
			kind: "service",
			gross: 480,
			grossDisplay: "$480",
			orders: 2,
			views: 10,
			conversion: null,
		}],
		(slug) => `/catalogue/${slug}?tab=analytics`,
	);
	assertEquals(row.href, "/catalogue/svc-abc?tab=analytics");
	assertEquals(row.conversion, "—");
});

Deno.test("toRevenue — weekly buckets are named as weeks", () => {
	const view = toRevenue(
		[{ date: "2026-10-05", value: 0 }, { date: "2026-10-12", value: 120 }],
		"week",
	);
	assertEquals(view.labels, ["5 Oct", "12 Oct"]);
	assertEquals(view.names, ["Week of 5 Oct", "Week of 12 Oct"]);
	assertEquals(view.any, true);
	assertEquals(toRevenue([{ date: "2026-10-05", value: 0 }], "day").any, false);
});

Deno.test("asOfCaption — the last rolled-up day, and that it updates nightly", () => {
	assertEquals(asOfCaption("2026-10-13"), "Through 13 Oct · updated nightly");
});

Deno.test("analyticsQuery — defaults omitted; a listing wins over a scope; the dev axis only when set", () => {
	assertEquals(analyticsQuery({ kind: "catalogue", filter: "all" }, "30d"), "");
	assertEquals(
		analyticsQuery({ kind: "catalogue", filter: "model:session" }, "12m", "sparse"),
		"scope=model%3Asession&period=12m&sim=sparse",
	);
	assertEquals(
		analyticsQuery({ kind: "listing", slug: "svc-abc" }, "7d", null),
		"listing=svc-abc&period=7d",
	);
});

Deno.test("consoleAnalyticsTarget — an explicit scope, else the lane's type segment", () => {
	assertEquals(consoleAnalyticsTarget({ scope: "all", type: "product" }), {
		kind: "catalogue",
		filter: "product",
	});
	assertEquals(consoleAnalyticsTarget({ scope: "collection:spring", type: "service" }), {
		kind: "catalogue",
		filter: "collection:spring",
	});
});
// #endregion

// #region Rollups ↔ tiles
Deno.test("header rollups print what the canvas tiles print, for every window", () => {
	const now = new Date("2026-10-14T09:00:00Z");
	for (const sim of ["rich", "sparse", "empty"] as const) {
		for (const period of ["7d", "30d", "90d", "12m"] as const) {
			const read = fixtureOverview({ kind: "catalogue", filter: "all" }, period, sim, "USD", now);
			if (!read) throw new Error("fixture read missing");
			const header = headlineOf(read);
			const tiles = Object.fromEntries(toTiles(read).map((t) => [t.key, t]));

			assertEquals(header.asOf, read.asOf);
			assertEquals(header.period, period);
			assertEquals(tiles.gross.value, header.revenueLabel);
			assertEquals(tiles.gross.delta, deltaLabel(header.revenueChange));
			assertEquals(tiles.orders.value, header.orders.toLocaleString("en-US"));
			if (header.conversion === null) assertEquals(tiles.conversion.value, NOT_ENOUGH_DATA);
			else assertEquals(tiles.conversion.value, percentLabel(header.conversion));
		}
	}
});
// #endregion
