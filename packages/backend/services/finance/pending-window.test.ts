import { assertEquals } from "@std/assert";
import { PendingReleaseSchema } from "@projective/types/finance";
import { clearingKindLabel, type PendingRowRaw, stillClearing } from "./pending-window.ts";

const raw = (over: Partial<PendingRowRaw> = {}): PendingRowRaw => ({
	id: "p1",
	escrow_id: "e1",
	order_id: null,
	wallet_id: "w1",
	amount_cents: 10_000,
	recovered_cents: 0,
	currency: "GBP",
	released_at: "2026-10-13T10:00:00.000Z",
	available_at: "2026-10-20T10:00:00.000Z",
	...over,
});

Deno.test("stillClearing keeps an untouched release at its full amount", () => {
	assertEquals(stillClearing([raw()]).map((p) => p.amount_cents), [10_000]);
});

Deno.test("stillClearing counts only what a chargeback left", () => {
	assertEquals(stillClearing([raw({ recovered_cents: 2_500 })]).map((p) => p.amount_cents), [
		7_500,
	]);
});

Deno.test("stillClearing drops a row a chargeback emptied", () => {
	assertEquals(
		stillClearing([raw({ recovered_cents: 10_000 }), raw({ id: "p2", amount_cents: 300 })]).map((
			p,
		) => p.id),
		[
			"p2",
		],
	);
});

Deno.test("stillClearing reads bigint strings and clamps a nonsense recovery", () => {
	const rows = stillClearing([
		raw({ amount_cents: "4200", recovered_cents: "200" }),
		raw({ id: "p2", recovered_cents: -50 }),
		raw({ id: "p3", recovered_cents: null }),
	]);
	assertEquals(rows.map((p) => p.amount_cents), [4_000, 10_000, 10_000]);
});

Deno.test("clearingKindLabel names a sale and a release", () => {
	assertEquals(clearingKindLabel({ order_id: "o1" }), "Sale clearing");
	assertEquals(clearingKindLabel({ order_id: null }), "Release clearing");
});

const row = {
	id: "8c4b6a3e-1f8e-4c2a-9a55-2b7d8f0e1a10",
	escrowId: "0f7f8a77-35a8-4d5c-8f6c-3f4e1f0f2b11",
	orderId: null,
	walletId: "3d2f0b9a-7a1c-4f3e-b6a5-9d8c7e6f5a12",
	reason: "escrow_release",
	amountCents: 10_000,
	recoveredCents: 0,
	currency: "GBP",
	releasedAt: "2026-10-13T10:00:00.000Z",
	availableAt: "2026-10-20T10:00:00.000Z",
	state: "pending",
	maturedAt: null,
	transactionId: null,
	createdAt: "2026-10-13T10:00:00.000Z",
};

Deno.test("PendingReleaseSchema accepts a release keyed to one escrow", () => {
	assertEquals(PendingReleaseSchema.safeParse(row).success, true);
	assertEquals(
		PendingReleaseSchema.safeParse({
			...row,
			escrowId: null,
			orderId: row.escrowId,
			reason: "product_sale",
		}).success,
		true,
	);
});

Deno.test("PendingReleaseSchema refuses no source, two sources and an over-recovery", () => {
	assertEquals(PendingReleaseSchema.safeParse({ ...row, escrowId: null }).success, false);
	assertEquals(PendingReleaseSchema.safeParse({ ...row, orderId: row.walletId }).success, false);
	assertEquals(PendingReleaseSchema.safeParse({ ...row, recoveredCents: 10_001 }).success, false);
});
