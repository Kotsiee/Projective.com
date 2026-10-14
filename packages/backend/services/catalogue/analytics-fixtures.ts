import {
	type AnalyticsPeriod,
	type AnalyticsScope,
	type CatalogueAnalytics,
	lastRolledUpDay,
	shiftDay,
} from "@projective/types/catalogue";
import type { FxRateTable } from "@projective/types/finance";
import {
	buildAnalytics,
	type MinorConverter,
	type RollupRow,
	type StandingCounts,
	windowsFor,
} from "./analytics-model.ts";
import { FIXTURE_LISTINGS } from "./catalogue-fixtures.ts";
import { filterByScope, type ScopedListing } from "./listing-scope.ts";
import { projectorFor } from "../finance/commerce-money.ts";

/**
 * analytics-fixtures — the Analytics read with `CATALOGUE_BACKEND_LIVE=false`.
 *
 * Synthetic `daily_rollups` rows for the fixture catalogue, one deterministic shape per state of the
 * `catalogueAnalytics` dev axis, fed through the SAME {@link buildAnalytics} the live read uses — so
 * the thresholds and the currency rule are exercised by the fixtures too, never bypassed.
 */

// #region Simulation
/**
 * The states the Dev Context Switcher's `catalogueAnalytics` axis selects. Declared here rather than
 * imported from `apps/web/utils/dev-seam.ts`, which the backend must not depend on (root CLAUDE.md §2).
 * `auto` is the absence of a choice and reads as `rich`.
 */
export type CatalogueAnalyticsSim = "auto" | "empty" | "sparse" | "rich";

/** Whether a raw `?sim=` value is one of them. */
export function isCatalogueAnalyticsSim(raw: string): raw is CatalogueAnalyticsSim {
	return raw === "auto" || raw === "empty" || raw === "sparse" || raw === "rich";
}
// #endregion

// #region Listings
/** The fixture catalogue as the scope resolver sees it. */
export function fixtureScopedListings(): ScopedListing[] {
	return FIXTURE_LISTINGS.flatMap(({ listing, blueprint, product }) => {
		const slug = blueprint?.slug ?? product?.slug;
		if (!slug) return [];
		return [{
			id: listing.id,
			slug,
			title: listing.title,
			kind: listing.kind,
			model: blueprint?.delivery_model ?? null,
			currency: listing.currency.toUpperCase(),
			createCategory: listing.create_category,
			blueprintId: listing.service_blueprint_id,
			productId: listing.product_id,
		}];
	});
}
// #endregion

// #region Rows
function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
}

/** A deterministic integer in `[0, span)` for one listing, day and figure. */
function pick(listing: string, day: string, figure: string, span: number): number {
	return span <= 0 ? 0 : hash(`${listing}|${day}|${figure}`) % span;
}

const QUERIES = ["brand identity", "logo design", "figma mentoring", "launch video", "ui kit"];
const PRICE_MINOR = 18_000;

function row(
	l: ScopedListing,
	day: string,
	metric: string,
	value: number,
	dimensions: Record<string, unknown> = {},
	sample = value,
): RollupRow[] {
	return value > 0
		? [{ day, metric, subject_id: l.id, dimensions, value, sample_count: sample }]
		: [];
}

function richDay(l: ScopedListing, day: string): RollupRow[] {
	const impressions = 40 + pick(l.id, day, "imp", 120);
	const views = Math.round(impressions * (0.2 + pick(l.id, day, "view", 20) / 100));
	const clicks = Math.round(views * 0.8);
	const checkout = Math.round(views * (0.05 + pick(l.id, day, "chk", 6) / 100));
	const orders = Math.round(checkout * 0.5);
	const out = [
		...row(l, day, "listing.impressions", impressions),
		...row(l, day, "listing.clicks", clicks),
		...row(l, day, "listing.views", views),
		...row(l, day, "listing.checkout_starts", checkout),
		...row(l, day, "listing.orders", orders),
		...row(l, day, "listing.gross_minor", orders * PRICE_MINOR, { currency: l.currency }, orders),
		...row(l, day, "listing.cancellations", pick(l.id, day, "cxl", 12) === 0 ? 1 : 0),
	];
	if (l.model === "session" || l.model === "group_session") {
		const bookings = pick(l.id, day, "bk", 3);
		out.push(...row(l, day, "listing.bookings", bookings));
		for (let i = 0; i < bookings; i++) {
			const dow = pick(l.id, day, `dow${i}`, 7);
			const hour = 9 + pick(l.id, day, `hr${i}`, 9);
			out.push(...row(l, day, "listing.booking_slot", 1, { dow, hour }));
		}
	}
	const q = QUERIES[pick(l.id, day, "q", QUERIES.length)];
	const sessions = 5 + pick(l.id, day, "qs", 5);
	out.push(...row(l, day, "listing.query_impressions", sessions * 2, { q }, sessions));
	out.push(...row(l, day, "listing.query_clicks", pick(l.id, day, "qc", sessions), { q }, 1));
	return out;
}

function sparseDay(l: ScopedListing, day: string): RollupRow[] {
	if (pick(l.id, day, "on", 15) !== 0) return [];
	const impressions = 1 + pick(l.id, day, "imp", 4);
	const views = 1;
	const orders = pick(l.id, day, "ord", 4) === 0 ? 1 : 0;
	return [
		...row(l, day, "listing.impressions", impressions),
		...row(l, day, "listing.views", views),
		...row(l, day, "listing.orders", orders),
		...row(l, day, "listing.gross_minor", orders * PRICE_MINOR, { currency: l.currency }, orders),
	];
}

/** The synthetic rollup rows for a set of listings over `[from, through]`. */
export function fixtureRollups(
	listings: readonly ScopedListing[],
	from: string,
	through: string,
	sim: CatalogueAnalyticsSim,
): RollupRow[] {
	if (sim === "empty") return [];
	const day = sim === "sparse" ? sparseDay : richDay;
	const out: RollupRow[] = [];
	for (let d = from; d <= through; d = shiftDay(d, 1)) {
		for (const l of listings) out.push(...day(l, d));
	}
	return out;
}

const STANDING: Readonly<Record<Exclude<CatalogueAnalyticsSim, "auto">, StandingCounts>> = {
	empty: { current: 0, previous: 0 },
	sparse: { current: 1, previous: 0 },
	rich: { current: 7, previous: 5 },
};
// #endregion

// #region Overview
/**
 * The fixture overview, or `null` when a listing scope names no fixture listing. A `collection:`
 * scope covers nothing: the fixture catalogue has no collections.
 */
export function fixtureOverview(
	scope: AnalyticsScope,
	period: AnalyticsPeriod,
	sim: CatalogueAnalyticsSim,
	display: string,
	now: Date,
): CatalogueAnalytics | null {
	const state = sim === "auto" ? "rich" : sim;
	const all = fixtureScopedListings();
	const listings = scope.kind === "listing"
		? all.filter((l) => l.slug === scope.listingId)
		: filterByScope(all, scope.filter);
	if (scope.kind === "listing" && listings.length === 0) return null;
	const windows = windowsFor(period, lastRolledUpDay(now));
	return buildAnalytics({
		scope,
		period,
		listings,
		rows: fixtureRollups(listings, windows.previous.from, windows.current.through, state),
		windows,
		standing: listings.some((l) => l.createCategory) ? STANDING[state] : null,
		timezone: "Europe/London",
		display,
		convert: fixtureConverter,
	});
}

/**
 * Fixed reference rates for the fixture catalogue's currencies (USD base), so a mixed-currency
 * fixture read converts every listing's gross the way the live read does through `FxService`, and
 * stays deterministic. A currency outside the table converts to `null`, as an unknown one does live.
 */
const FIXTURE_RATES: FxRateTable = {
	base: "USD",
	rates: { USD: 1, GBP: 0.79, EUR: 0.92, JPY: 150 },
	asOf: "2026-01-01T00:00:00.000Z",
	provider: "seed",
	stale: false,
};

/** The fixture read's converter: the live converter's shape over {@link FIXTURE_RATES}. */
export const fixtureConverter: MinorConverter = (minor, from, to) => {
	const projector = projectorFor(to, FIXTURE_RATES);
	return projector.canConvert(from) ? projector.convertMinor(minor, from) : null;
};
// #endregion
