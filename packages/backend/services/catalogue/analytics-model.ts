import {
	type AnalyticsPeriod,
	analyticsPeriodDays,
	type AnalyticsScope,
	type AnalyticsWindow,
	type CatalogueAnalytics,
	type FunnelStep,
	type HeatCell,
	KEYWORD_MIN_SESSIONS,
	type KeywordRow,
	type MetricDelta,
	type MetricKey,
	type MetricTile,
	money,
	rateOrNull,
	seriesBucketOf,
	type SeriesPoint,
	shiftDay,
	type TopListingRow,
} from "@projective/types/catalogue";
import { toMajorUnits } from "@projective/types/finance";
import { type ScopedListing, sellsSessions } from "./listing-scope.ts";

/**
 * analytics-model — the PURE half of {@link CatalogueAnalyticsBackendService.overview}: rollup rows in,
 * a {@link CatalogueAnalytics} out. Every threshold (Decision #217(k)) and every currency decision is
 * made here, so the live read and the fixtures go through the same arithmetic and the tests hold it
 * without a database.
 */

// #region Inputs
/** An `analytics.daily_rollups` row as the read selects it. */
export interface RollupRow {
	day: string;
	metric: string;
	subject_id: string;
	dimensions: Record<string, unknown> | null;
	value: number | string;
	sample_count: number | string;
}

/** The current window and the one before it, for deltas. */
export interface AnalyticsWindows {
	current: { from: string; through: string };
	previous: { from: string; through: string };
}

/** Reviews and stage completions credited to the scope's CREATE categories, per window. */
export interface StandingCounts {
	current: number;
	previous: number;
}

/** Minor units in one currency → minor units in another, or `null` when no rate exists. */
export type MinorConverter = (minor: number, from: string, to: string) => number | null;

/** Everything one overview is computed from. */
export interface AnalyticsInputs {
	scope: AnalyticsScope;
	period: AnalyticsPeriod;
	/** The listings in scope; rows of any other subject are ignored. */
	listings: readonly ScopedListing[];
	rows: readonly RollupRow[];
	windows: AnalyticsWindows;
	/** `null` when no listing in scope has a CREATE category, so nothing feeds a category's Standing. */
	standing: StandingCounts | null;
	timezone: string;
	/** The viewer's display currency, used only when gross spans currencies. */
	display: string;
	/** Present when gross spans currencies; the caller fetches rates only then. */
	convert: MinorConverter | null;
}
// #endregion

// #region Window
const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

function shortDate(day: string): string {
	return SHORT_DATE.format(new Date(`${day}T00:00:00Z`));
}

/** The window of `period` ending on `asOf`, and the equal window before it. */
export function windowsFor(period: AnalyticsPeriod, asOf: string): AnalyticsWindows {
	const days = analyticsPeriodDays(period);
	const from = shiftDay(asOf, -(days - 1));
	return {
		current: { from, through: asOf },
		previous: { from: shiftDay(from, -days), through: shiftDay(from, -1) },
	};
}

/** The window as the canvas states it: its days, and that today is not in them. */
export function windowLabel(window: { from: string; through: string }): AnalyticsWindow {
	return {
		...window,
		label: `${shortDate(window.from)} – ${shortDate(window.through)} · today not included`,
	};
}
// #endregion

// #region Aggregation
function num(v: number | string | null | undefined): number {
	const n = typeof v === "string" ? Number(v) : v ?? 0;
	return Number.isFinite(n) ? n : 0;
}

function inWindow(day: string, w: { from: string; through: string }): boolean {
	return day >= w.from && day <= w.through;
}

interface Totals {
	impressions: number;
	clicks: number;
	views: number;
	checkoutStarts: number;
	orders: number;
	cancellations: number;
	grossMinor: number;
}

function emptyTotals(): Totals {
	return {
		impressions: 0,
		clicks: 0,
		views: 0,
		checkoutStarts: 0,
		orders: 0,
		cancellations: 0,
		grossMinor: 0,
	};
}

const COUNTERS: Readonly<Record<string, keyof Omit<Totals, "grossMinor">>> = {
	"listing.impressions": "impressions",
	"listing.clicks": "clicks",
	"listing.views": "views",
	"listing.checkout_starts": "checkoutStarts",
	"listing.orders": "orders",
	"listing.cancellations": "cancellations",
};

function currencyOf(row: RollupRow): string | null {
	const c = row.dimensions?.currency;
	return typeof c === "string" && /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : null;
}

/**
 * The currency gross is reported in: the single currency it was taken in, else (several) the viewer's
 * display currency, else (none) the first listing's.
 */
export function reportingCurrency(
	rows: readonly RollupRow[],
	listings: readonly ScopedListing[],
	display: string,
): { currency: string; mixed: boolean } {
	const seen = new Set<string>();
	for (const r of rows) {
		if (r.metric !== "listing.gross_minor") continue;
		const c = currencyOf(r);
		if (c) seen.add(c);
	}
	if (seen.size === 1) return { currency: [...seen][0], mixed: false };
	if (seen.size > 1) return { currency: display.toUpperCase(), mixed: true };
	return { currency: listings[0]?.currency ?? display.toUpperCase(), mixed: false };
}

/** A gross row's minor units in `target`; a currency with no rate counts as nothing, never as 1:1. */
function grossIn(row: RollupRow, target: string, convert: MinorConverter | null): number {
	const from = currencyOf(row);
	const minor = num(row.value);
	if (!from || from === target) return minor;
	return convert?.(minor, from, target) ?? 0;
}
// #endregion

// #region Tiles
function deltaOf(current: number | null, previous: number | null): MetricDelta | null {
	if (current === null || previous === null || previous === 0) return null;
	const change = Math.round(((current - previous) / previous) * 1000) / 10;
	return { change, direction: change > 0 ? "up" : change < 0 ? "down" : "flat" };
}

const COUNT = new Intl.NumberFormat("en-US");

function percent(rate: number): string {
	return `${(Math.round(rate * 1000) / 10).toFixed(1)}%`;
}

const NOT_ENOUGH = "Not enough data yet";

function rateTile(
	key: MetricKey,
	label: string,
	current: number | null,
	previous: number | null,
): MetricTile {
	return {
		key,
		label,
		value: current,
		display: current === null ? NOT_ENOUGH : percent(current),
		delta: deltaOf(current, previous),
		sufficient: current !== null,
	};
}

function countTile(key: MetricKey, label: string, current: number, previous: number): MetricTile {
	return {
		key,
		label,
		value: current,
		display: COUNT.format(current),
		delta: deltaOf(current, previous),
		sufficient: true,
	};
}
// #endregion

// #region Build
function seriesFor(
	rows: readonly RollupRow[],
	window: { from: string; through: string },
	period: AnalyticsPeriod,
	currency: string,
	convert: MinorConverter | null,
): SeriesPoint[] {
	const step = seriesBucketOf(period) === "week" ? 7 : 1;
	const starts: string[] = [];
	for (let day = window.from; day <= window.through; day = shiftDay(day, step)) starts.push(day);
	const minor = new Array<number>(starts.length).fill(0);
	const fromMs = Date.parse(`${window.from}T00:00:00Z`);
	for (const r of rows) {
		if (r.metric !== "listing.gross_minor" || !inWindow(r.day, window)) continue;
		const offset = Math.round((Date.parse(`${r.day}T00:00:00Z`) - fromMs) / 86_400_000);
		minor[Math.floor(offset / step)] += grossIn(r, currency, convert);
	}
	return starts.map((date, i) => ({ date, value: toMajorUnits(minor[i], currency) ?? 0 }));
}

function heatmapFor(
	rows: readonly RollupRow[],
	window: { from: string; through: string },
): HeatCell[] {
	const cells = new Array<number>(7 * 24).fill(0);
	for (const r of rows) {
		if (r.metric !== "listing.booking_slot" || !inWindow(r.day, window)) continue;
		const dow = Number(r.dimensions?.dow);
		const hour = Number(r.dimensions?.hour);
		if (
			!Number.isInteger(dow) || dow < 0 || dow > 6 || !Number.isInteger(hour) || hour < 0 ||
			hour > 23
		) {
			continue;
		}
		cells[dow * 24 + hour] += Math.max(0, Math.round(num(r.value)));
	}
	return cells.map((value, i) => ({ dow: Math.floor(i / 24), hour: i % 24, value }));
}

function keywordsFor(
	rows: readonly RollupRow[],
	window: { from: string; through: string },
): KeywordRow[] {
	const byQuery = new Map<string, { impressions: number; sessions: number; clicks: number }>();
	for (const r of rows) {
		if (!inWindow(r.day, window)) continue;
		if (r.metric !== "listing.query_impressions" && r.metric !== "listing.query_clicks") continue;
		const q = r.dimensions?.q;
		if (typeof q !== "string" || q.length === 0) continue;
		const query = q.slice(0, 120);
		const acc = byQuery.get(query) ?? { impressions: 0, sessions: 0, clicks: 0 };
		if (r.metric === "listing.query_impressions") {
			acc.impressions += Math.round(num(r.value));
			acc.sessions += Math.round(num(r.sample_count));
		} else {
			acc.clicks += Math.round(num(r.value));
		}
		byQuery.set(query, acc);
	}
	return [...byQuery.entries()]
		.filter(([, k]) => k.sessions >= KEYWORD_MIN_SESSIONS && k.impressions > 0)
		.map(([query, k]) => ({
			query,
			impressions: k.impressions,
			sessions: k.sessions,
			clicks: k.clicks,
			ctr: rateOrNull(k.clicks, k.impressions),
		}))
		.sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query))
		.slice(0, 50);
}

function funnelFor(t: Totals): FunnelStep[] {
	return [
		{ key: "impressions", label: "Impressions", count: t.impressions, rate: null },
		{ key: "views", label: "Views", count: t.views, rate: rateOrNull(t.views, t.impressions) },
		{
			key: "checkout_starts",
			label: "Checkout starts",
			count: t.checkoutStarts,
			rate: rateOrNull(t.checkoutStarts, t.views),
		},
		{
			key: "orders",
			label: "Orders",
			count: t.orders,
			rate: rateOrNull(t.orders, t.checkoutStarts),
		},
	];
}

/** Assemble one analytics read. Pure. */
export function buildAnalytics(input: AnalyticsInputs): CatalogueAnalytics {
	const { windows, period } = input;
	const inScope = new Map(input.listings.map((l) => [l.id, l]));
	const rows = input.rows.filter((r) => inScope.has(r.subject_id));
	const { currency, mixed } = reportingCurrency(rows, input.listings, input.display);
	const convert = mixed ? input.convert : null;

	const current = emptyTotals();
	const previous = emptyTotals();
	const perListing = new Map<string, Totals>();
	for (const r of rows) {
		const bucket = inWindow(r.day, windows.current)
			? current
			: inWindow(r.day, windows.previous)
			? previous
			: null;
		if (!bucket) continue;
		let own: Totals | null = null;
		if (bucket === current) {
			own = perListing.get(r.subject_id) ?? emptyTotals();
			perListing.set(r.subject_id, own);
		}
		const counter = COUNTERS[r.metric];
		if (counter) {
			const v = Math.round(num(r.value));
			bucket[counter] += v;
			if (own) own[counter] += v;
		} else if (r.metric === "listing.gross_minor") {
			const minor = grossIn(r, currency, convert);
			bucket.grossMinor += minor;
			if (own) own.grossMinor += minor;
		}
	}

	const grossNow = toMajorUnits(current.grossMinor, currency) ?? 0;
	const grossBefore = toMajorUnits(previous.grossMinor, currency) ?? 0;
	const tiles: MetricTile[] = [
		{
			key: "gross",
			label: "Gross volume",
			value: grossNow,
			display: money(grossNow, currency),
			delta: deltaOf(grossNow, grossBefore),
			sufficient: true,
		},
		countTile("orders", "Orders", current.orders, previous.orders),
		rateTile(
			"conversion",
			"Conversion",
			rateOrNull(current.orders, current.views),
			rateOrNull(previous.orders, previous.views),
		),
		rateTile(
			"churn",
			"Churn",
			rateOrNull(current.cancellations, current.orders),
			rateOrNull(previous.cancellations, previous.orders),
		),
		input.standing
			? countTile(
				"standing_impact",
				"Standing impact",
				input.standing.current,
				input.standing.previous,
			)
			: {
				key: "standing_impact",
				label: "Standing impact",
				value: null,
				display: "No CREATE category",
				delta: null,
				sufficient: false,
			},
	];

	const topListings: TopListingRow[] = input.scope.kind === "catalogue"
		? [...perListing.entries()]
			.flatMap(([id, t]) => {
				const l = inScope.get(id);
				if (!l || (t.grossMinor === 0 && t.orders === 0 && t.views === 0)) return [];
				const gross = toMajorUnits(t.grossMinor, currency) ?? 0;
				return [{
					id: l.slug,
					title: l.title.slice(0, 200),
					kind: l.kind,
					gross,
					grossDisplay: money(gross, currency),
					orders: t.orders,
					views: t.views,
					conversion: rateOrNull(t.orders, t.views),
				}];
			})
			.sort((a, b) => b.gross - a.gross || b.orders - a.orders || a.id.localeCompare(b.id))
			.slice(0, 10)
		: [];

	return {
		scope: input.scope,
		period,
		currency,
		timezone: input.timezone,
		window: windowLabel(windows.current),
		tiles,
		revenue: seriesFor(rows, windows.current, period, currency, convert),
		bucket: seriesBucketOf(period),
		funnel: funnelFor(current),
		heatmap: sellsSessions(input.listings) ? heatmapFor(rows, windows.current) : [],
		keywords: keywordsFor(rows, windows.current),
		topListings,
		asOf: windows.current.through,
	};
}
// #endregion
