import { assertEquals } from "@std/assert";
import { planStalePayout, RESEND_WINDOW_MS } from "./payout-sweep.ts";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

Deno.test("a transfer Stripe already made completes the payout, however old", () => {
	assertEquals(
		planStalePayout({ destination: "acct_1", initiatedAt: ago(3 * RESEND_WINDOW_MS) }, {
			id: "tr_1",
		}, NOW),
		{ kind: "complete", transfer: "tr_1" },
	);
});

Deno.test("no transfer inside the idempotency window is re-sent under the same key", () => {
	assertEquals(
		planStalePayout({ destination: "acct_1", initiatedAt: ago(20 * 60 * 1000) }, null, NOW),
		{ kind: "resend" },
	);
});

Deno.test("no transfer once the key has expired returns the money rather than risk a second transfer", () => {
	const plan = planStalePayout(
		{ destination: "acct_1", initiatedAt: ago(RESEND_WINDOW_MS) },
		null,
		NOW,
	);
	assertEquals(plan.kind, "fail");
});

Deno.test("a payout with nowhere to go is returned to the wallet", () => {
	const plan = planStalePayout({ destination: null, initiatedAt: ago(20 * 60 * 1000) }, null, NOW);
	assertEquals(plan.kind, "fail");
});

Deno.test("an unreadable start time is treated as expired, never re-sent", () => {
	assertEquals(
		planStalePayout({ destination: "acct_1", initiatedAt: "not a date" }, null, NOW).kind,
		"fail",
	);
});
