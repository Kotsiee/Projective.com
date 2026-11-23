import { assertEquals } from "@std/assert";
import { begunPayoutOf } from "./live-payments.ts";

/*
 * finance.begin_payout → BegunPayout. Under the Safety Hold (Decision #529) the door answers rather than
 * raises, so a held answer read as a payout would send a Transfer for money that never left the wallet.
 */

Deno.test("begunPayoutOf: a held answer is held, with its end and no payout", () => {
	assertEquals(
		begunPayoutOf({
			held: true,
			held_until: "2026-11-26T14:05:00+00:00",
			wallet_id: "046c1c0c-b930-458d-a6a3-18c6786538d7",
			amount_cents: 100000,
			currency: "USD",
			replayed: false,
		}),
		{ held: true, heldUntil: "2026-11-26T14:05:00+00:00" },
	);
});

Deno.test("begunPayoutOf: a begun payout keeps its row, destination and replay flag", () => {
	const begun = begunPayoutOf({
		id: "69bfc4f9-3f67-4d98-b0a8-1a3714327a8c",
		wallet_id: "046c1c0c-b930-458d-a6a3-18c6786538d7",
		amount_cents: 1000,
		currency: "USD",
		status: "pending",
		instant: false,
		provider: "stripe",
		initiated_at: "2026-11-23T15:55:18+00:00",
		created_at: "2026-11-23T15:55:18+00:00",
		destination: "acct_XXXX-XXXX",
		replayed: true,
	});
	assertEquals(begun.held, false);
	if (begun.held) return;
	assertEquals(begun.payout.id, "69bfc4f9-3f67-4d98-b0a8-1a3714327a8c");
	assertEquals(begun.payout.amountCents, 1000);
	assertEquals(begun.destination, "acct_XXXX-XXXX");
	assertEquals(begun.replayed, true);
});
