import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "supabaseClient";
import {
	type CatalogueAnalytics,
	lastRolledUpDay,
	type MetricKey,
	RATE_MIN_DENOMINATOR,
} from "@projective/types/catalogue";
import {
	type AnalyticsInputs,
	buildAnalytics,
	headlineOf,
	type RollupRow,
	windowsFor,
} from "./analytics-model.ts";
import { liveHeadline } from "./live-catalogue-analytics.ts";
import type { ScopedListing } from "./listing-scope.ts";

/**
 * analytics-headline_test — the console header's rollups and the Analytics canvas's tiles are ONE
 * definition (C15): the header's gross, orders and conversion are the tiles' own figures for the same
 * scope and window — the same rollups, the window ending on the last rolled-up day, the same
 * `rateOrNull` threshold. Held twice: on the pure copy ({@link headlineOf}), and on the live read the
 * list service calls ({@link liveHeadline}), against a stub database.
 */

// #region Harness
const ASOF = "2026-10-13";
const NOW = new Date("2026-10-14T09:00:00Z");

function listing(n: number, fields: Partial<ScopedListing> = {}): ScopedListing {
	return {
		id: `00000000-0000-4000-8000-00000000000${n}`,
		slug: `svc-listing${n}a`,
		title: `Listing ${n}`,
		kind: "service",
		model: "one_off",
		currency: "USD",
		createCategory: null,
		blueprintId: `bp-${n}`,
		productId: null,
		...fields,
	};
}

const SERVICE = listing(1);
const PRODUCT = listing(2, {
	slug: "prd-listing2a",
	kind: "product",
	model: null,
	blueprintId: null,
	productId: "prod-2",
});

function rollup(
	l: ScopedListing,
	day: string,
	metric: string,
	value: number,
	dims = {},
): RollupRow {
	return { day, metric, subject_id: l.id, dimensions: dims, value, sample_count: value };
}

/** A month of sales on both listings, with a previous window to compare against. */
function rows(views: number): RollupRow[] {
	return [
		rollup(SERVICE, ASOF, "listing.views", views),
		rollup(SERVICE, ASOF, "listing.orders", 3),
		rollup(SERVICE, ASOF, "listing.gross_minor", 48_000, { currency: "USD" }),
		rollup(SERVICE, "2026-09-01", "listing.gross_minor", 24_000, { currency: "USD" }),
		rollup(PRODUCT, "2026-10-02", "listing.views", 10),
		rollup(PRODUCT, "2026-10-02", "listing.orders", 2),
		rollup(PRODUCT, "2026-10-02", "listing.gross_minor", 3_000, { currency: "USD" }),
	];
}

function build(rollups: RollupRow[], extra: Partial<AnalyticsInputs> = {}): CatalogueAnalytics {
	return buildAnalytics({
		scope: { kind: "catalogue", filter: "all" },
		period: "30d",
		listings: [SERVICE, PRODUCT],
		rows: rollups,
		windows: windowsFor("30d", ASOF),
		standing: null,
		timezone: "UTC",
		display: "USD",
		convert: null,
		...extra,
	});
}

function tile(a: CatalogueAnalytics, key: MetricKey) {
	const t = a.tiles.find((x) => x.key === key);
	if (!t) throw new Error(`no ${key} tile`);
	return t;
}

/** The header must print exactly what the tiles print. */
function assertAgrees(a: CatalogueAnalytics): void {
	const h = headlineOf(a);
	assertEquals(h.period, a.period);
	assertEquals(h.asOf, a.asOf);
	assertEquals(h.revenue, tile(a, "gross").value);
	assertEquals(h.revenueLabel, tile(a, "gross").display);
	assertEquals(h.revenueChange, tile(a, "gross").delta?.change ?? null);
	assertEquals(h.orders, tile(a, "orders").value);
	const conversion = tile(a, "conversion");
	assertEquals(h.conversion, conversion.sufficient ? conversion.value : null);
}
// #endregion

// #region Pure agreement
Deno.test("headlineOf — copies the gross, orders and conversion tiles verbatim", () => {
	const a = build(rows(90));
	assertAgrees(a);
	const h = headlineOf(a);
	assertEquals(h.orders, 5);
	assertEquals(h.revenue, 510);
	assertEquals(h.revenueLabel, "$510");
	assertEquals(h.revenueChange, 112.5);
	assertEquals(h.conversion, 5 / 100);
});

Deno.test("headlineOf — conversion is withheld below the same threshold the tile uses", () => {
	const thin = build(rows(RATE_MIN_DENOMINATOR - 11));
	assertAgrees(thin);
	assertEquals(tile(thin, "conversion").sufficient, false);
	assertEquals(headlineOf(thin).conversion, null);

	const enough = build(rows(RATE_MIN_DENOMINATOR - 10));
	assertAgrees(enough);
	assertEquals(headlineOf(enough).conversion, 5 / RATE_MIN_DENOMINATOR);
});

Deno.test("headlineOf — no previous window means no change, never a jump from zero", () => {
	const a = build(rows(90).filter((r) => r.day !== "2026-09-01"));
	assertAgrees(a);
	assertEquals(headlineOf(a).revenueChange, null);
});

Deno.test("headlineOf — every period ends on the last rolled-up day, as the canvas does", () => {
	for (const period of ["7d", "30d", "90d", "12m"] as const) {
		const a = build(rows(90), { period, windows: windowsFor(period, ASOF) });
		assertAgrees(a);
		assertEquals(headlineOf(a).asOf, ASOF);
	}
});

Deno.test("headlineOf — mixed currencies are reported in the display currency, as the tile is", () => {
	const mixed = [
		...rows(90),
		rollup(PRODUCT, ASOF, "listing.gross_minor", 1_000, { currency: "EUR" }),
	];
	const a = build(mixed, {
		display: "GBP",
		convert: (minor, from) => (from === "USD" ? minor * 0.8 : from === "EUR" ? minor * 0.9 : null),
	});
	assertAgrees(a);
	assertEquals(a.currency, "GBP");
});
// #endregion

// #region Live agreement
interface RollupCall {
	p_listing_ids: string[];
	p_from: string;
	p_to: string;
}

/**
 * Just enough of a Supabase client for {@link liveHeadline}: the seller's listings, their blueprint
 * and product slugs, and `catalogue.get_listing_rollups` answering only for the ids it was asked about.
 */
function stubDb(all: RollupRow[]): { db: SupabaseClient; calls: RollupCall[] } {
	const calls: RollupCall[] = [];
	const tables: Record<string, unknown[]> = {
		listings: [SERVICE, PRODUCT].map((l) => ({
			id: l.id,
			kind: l.kind,
			title: l.title,
			currency: l.currency,
			create_category: l.createCategory,
			service_blueprint_id: l.blueprintId,
			product_id: l.productId,
		})),
		service_blueprints: [{
			id: SERVICE.blueprintId,
			slug: SERVICE.slug,
			delivery_model: "one_off",
		}],
		products: [{ id: PRODUCT.productId, slug: PRODUCT.slug }],
	};
	const chainOf = (rowsOut: unknown[]) => {
		const chain: Record<string, unknown> = {};
		for (const m of ["select", "eq", "is", "in", "order", "limit"]) chain[m] = () => chain;
		chain.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
			Promise.resolve({ data: rowsOut, error: null }).then(ok, ko);
		return chain;
	};
	const schema = {
		from: (table: string) => chainOf(tables[table] ?? []),
		rpc: (name: string, args: RollupCall) => {
			if (name !== "get_listing_rollups") throw new Error(`unexpected rpc ${name}`);
			calls.push(args);
			const answer = all.filter((r) =>
				args.p_listing_ids.includes(r.subject_id) && r.day >= args.p_from && r.day <= args.p_to
			);
			return {
				range: (from: number, to: number) =>
					Promise.resolve({ data: answer.slice(from, to + 1), error: null }),
			};
		},
	};
	return { db: { schema: () => schema } as unknown as SupabaseClient, calls };
}

const ACTOR = { userId: "user-1", contextType: "personal" as const, contextId: "user-1" };

Deno.test("liveHeadline — reads the canvas's window and prints the canvas's tiles", async () => {
	const all = rows(90);
	const { db, calls } = stubDb(all);
	const headline = await liveHeadline(db, ACTOR, "all", "30d", "USD", NOW);

	const windows = windowsFor("30d", lastRolledUpDay(NOW));
	assertEquals(lastRolledUpDay(NOW), ASOF);
	assertEquals(calls.length, 1);
	assertEquals(calls[0].p_from, windows.previous.from);
	assertEquals(calls[0].p_to, windows.current.through);

	const canvas = build(all);
	assertEquals(headline, headlineOf(canvas));
});

Deno.test("liveHeadline — the type segment scopes it exactly as the canvas's console scope", async () => {
	const all = rows(90);
	const { db, calls } = stubDb(all);
	const headline = await liveHeadline(db, ACTOR, "product", "30d", "USD", NOW);

	assertEquals(calls[0].p_listing_ids, [PRODUCT.id]);
	const canvas = build(all, {
		scope: { kind: "catalogue", filter: "product" },
		listings: [PRODUCT],
	});
	assertEquals(headline, headlineOf(canvas));
	assertEquals(headline.orders, 2);
	assertEquals(headline.conversion, null);
});
// #endregion
