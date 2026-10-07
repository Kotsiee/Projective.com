import { assert, assertEquals } from "@std/assert";
import { decodeLedgerCursor, encodeLedgerCursor, ledgerKindOf } from "@projective/types/finance";
import type { MoneyProjector } from "./commerce-money.ts";
import type { WalletContext } from "./wallet-scope.ts";
import {
	addGrain,
	bucketSeries,
	cardBrandOf,
	dateLabel,
	type FlowBucketRow,
	kindTotals,
	ledgerGroup,
	rangeStart,
	reasonsForKinds,
	reasonsMatching,
	safeTimeZone,
	settlementOf,
	truncateDay,
	walletsMatching,
	zonedMidnight,
} from "./wallet-ledger.ts";

/** A projector that converts EUR at 0.5 and everything else 1:1 — enough to see "convert once". */
function projector(): MoneyProjector {
	const rate = (c: string) => (c.toUpperCase() === "EUR" ? 0.5 : 1);
	return {
		display: "GBP",
		canConvert: () => true,
		convertMinor: (minor: number, currency: string) => Math.round(minor * rate(currency)),
		price: (minor: number, currency: string) => ({
			minor,
			currency,
			display: `${minor}`,
			origin: null,
		}),
		derived: (minor: number) => ({ minor, currency: "GBP", display: `${minor}`, origin: null }),
	} as unknown as MoneyProjector;
}

const ctx = { money: projector(), timezone: "Europe/London" } as unknown as WalletContext;

Deno.test("the viewer's calendar decides Today, Yesterday and the group a line is filed under", () => {
	// 00:30 on 6 Oct in London is still 5 Oct in UTC.
	const now = Date.parse("2026-10-06T12:00:00Z");
	const early = "2026-10-05T23:30:00Z";
	assertEquals(dateLabel(early, now, "Europe/London"), "Today");
	assertEquals(dateLabel(early, now, "UTC"), "Yesterday");
	assertEquals(dateLabel("2026-10-03T09:00:00Z", now, "UTC"), "3 days ago");
	assertEquals(dateLabel("2026-09-12T09:00:00Z", now, "UTC"), "12 Sept");
	assertEquals(dateLabel("2025-09-12T09:00:00Z", now, "UTC"), "12 Sept 2025");
	assertEquals(ledgerGroup(early, now, "Europe/London"), "Today");
	assertEquals(ledgerGroup("2026-10-05T10:00:00Z", now, "Europe/London"), "Yesterday");
	assertEquals(ledgerGroup("2026-09-02T10:00:00Z", now, "Europe/London"), "September 2026");
});

Deno.test("a zone is accepted only when it is one, and midnight lands on the zone's own midnight", () => {
	assertEquals(safeTimeZone("Europe/London"), "Europe/London");
	assertEquals(safeTimeZone("Mars/Olympus"), null);
	assertEquals(safeTimeZone(""), null);
	assertEquals(safeTimeZone(null), null);
	// BST (+1) in summer, GMT in winter; New York across its own DST change.
	assertEquals(zonedMidnight("2026-07-01", "Europe/London"), "2026-06-30T23:00:00.000Z");
	assertEquals(zonedMidnight("2026-12-01", "Europe/London"), "2026-12-01T00:00:00.000Z");
	assertEquals(zonedMidnight("2026-03-08", "America/New_York"), "2026-03-08T05:00:00.000Z");
	assertEquals(zonedMidnight("2026-03-09", "America/New_York"), "2026-03-09T04:00:00.000Z");
});

Deno.test("the ruler's window starts on the viewer's calendar, inclusive of today", () => {
	const now = Date.parse("2026-10-06T12:00:00Z");
	assertEquals(rangeStart("7d", now, "UTC"), "2026-09-30T00:00:00.000Z");
	assertEquals(rangeStart("12m", now, "UTC"), "2025-11-01T00:00:00.000Z");
	assertEquals(rangeStart("7d", now, "Europe/London"), "2026-09-29T23:00:00.000Z");
	assertEquals(rangeStart(undefined, now, "UTC"), null);
	assertEquals(rangeStart("all", now, "UTC"), null);
});

Deno.test("calendar buckets truncate to ISO weeks and months and step by the grain", () => {
	assertEquals(truncateDay("2026-10-08", "week"), "2026-10-05");
	assertEquals(truncateDay("2026-10-05", "week"), "2026-10-05");
	assertEquals(truncateDay("2026-10-11", "week"), "2026-10-05");
	assertEquals(truncateDay("2026-10-08", "month"), "2026-10-01");
	assertEquals(addGrain("2026-10-05", "week", -1), "2026-09-28");
	assertEquals(addGrain("2026-01-31", "month", 1).slice(0, 7), "2026-03");
	assertEquals(addGrain("2026-10-01", "month", -11), "2025-11-01");
});

Deno.test("a bucket series draws every calendar bucket and converts each origin currency once", () => {
	const rows: FlowBucketRow[] = [
		{
			bucket: "2026-10-01",
			currency: "GBP",
			direction: "credit",
			reason: "topup",
			total_cents: 1000,
			line_count: 1,
		},
		{
			bucket: "2026-10-01",
			currency: "EUR",
			direction: "credit",
			reason: "product_sale",
			total_cents: 3,
			line_count: 1,
		},
		{
			bucket: "2026-10-01",
			currency: "EUR",
			direction: "credit",
			reason: "service_sale",
			total_cents: 3,
			line_count: 1,
		},
		{
			bucket: "2026-10-03",
			currency: "GBP",
			direction: "debit",
			reason: "platform_fee",
			total_cents: 250,
			line_count: 2,
		},
	];
	const series = bucketSeries(ctx, rows, "2026-10-01", "2026-10-03", "day");
	assertEquals(series.map((p) => p.start), ["2026-10-01", "2026-10-02", "2026-10-03"]);
	// €0.03 + €0.03 summed as €0.06 then converted (3p), never 2p + 2p.
	assertEquals(series[0].inMinor, 1003);
	assertEquals(series[1], {
		label: "2 Oct",
		start: "2026-10-02",
		inMinor: 0,
		outMinor: 0,
		netMinor: 0,
	});
	assertEquals(series[2].netMinor, -250);

	const kinds = kindTotals(ctx, rows);
	// Ranked by volume; a tie keeps the families' own order.
	assertEquals(kinds.map((k) => k.kind), ["topup", "platform_fee", "service_sale", "product_sale"]);
	assertEquals(kinds.find((k) => k.kind === "platform_fee")?.lines, 2);
});

Deno.test("search words reach reason labels and the viewer's own accounts; families map to codes", () => {
	assert(reasonsMatching("release").includes("escrow_release"));
	assert(reasonsMatching("PLATFORM").includes("platform_fee"));
	assertEquals(reasonsMatching("   "), []);
	assertEquals(reasonsForKinds([]), null);
	assertEquals(reasonsForKinds(["other"]), null);
	assertEquals(reasonsForKinds(["platform_fee"]), ["platform_fee", "instant_payout_fee"]);
	assertEquals(ledgerKindOf("service_sale_vault_retention"), "service_sale");
	assertEquals(ledgerKindOf("something_new"), "other");
	const accounts = [
		{ owner: { name: "Atlas Labs" }, rows: [{ id: "w1" }, { id: "w2" }] },
		{ owner: { name: "Kwame" }, rows: [{ id: "w3" }] },
	] as unknown as WalletContext["accounts"];
	assertEquals(walletsMatching(accounts, "atlas"), ["w1", "w2"]);
});

Deno.test("settlement follows the escrow, the clearing window and any open card dispute", () => {
	const facts = {
		escrows: new Map([
			["e-held", { stage: null, party: null, status: "held", disputed: false, invoiceId: null }],
			["e-done", {
				stage: null,
				party: null,
				status: "released",
				disputed: false,
				invoiceId: null,
			}],
			["e-case", { stage: null, party: null, status: "released", disputed: true, invoiceId: null }],
		]),
		clearing: new Set(["e-done:w-clearing"]),
		contested: new Set(["t-charged-back"]),
	};
	const row = (patch: Record<string, unknown>) =>
		({
			id: "t",
			wallet_id: "w",
			fund_state: "available" as const,
			ref_table: "escrows",
			ref_id: "e-done",
			...patch,
		}) as Parameters<typeof settlementOf>[0];
	assertEquals(settlementOf(row({ ref_id: "e-held" }), facts), "pending");
	assertEquals(settlementOf(row({}), facts), "cleared");
	assertEquals(settlementOf(row({ wallet_id: "w-clearing" }), facts), "pending");
	assertEquals(settlementOf(row({ ref_id: "e-case" }), facts), "disputed");
	assertEquals(
		settlementOf(row({ id: "t-charged-back", ref_table: "inbound_payments" }), facts),
		"disputed",
	);
	assertEquals(
		settlementOf(row({ ref_table: null, ref_id: null, fund_state: "pending" }), facts),
		"pending",
	);
});

Deno.test("card brands normalise to the stored vocabulary", () => {
	assertEquals(cardBrandOf("Visa"), "visa");
	assertEquals(cardBrandOf("American Express"), "amex");
	assertEquals(cardBrandOf("master-card"), "mastercard");
	assertEquals(cardBrandOf("diners"), "unknown");
	assertEquals(cardBrandOf(null), "unknown");
});

Deno.test("a keyset cursor round-trips, and anything else is the first page", () => {
	const key = { at: "2026-10-05T19:43:51.732Z", id: "5601d78b-6a6f-4be4-aecd-78d2afc29275" };
	const cursor = encodeLedgerCursor(key);
	assert(/^k:[A-Za-z0-9_-]+$/.test(cursor));
	assertEquals(decodeLedgerCursor(cursor), key);
	assertEquals(decodeLedgerCursor("o:40"), null);
	assertEquals(decodeLedgerCursor("k:!!!"), null);
	assertEquals(decodeLedgerCursor(encodeLedgerCursor({ at: "not a date", id: key.id })), null);
	assertEquals(decodeLedgerCursor(null), null);
});
