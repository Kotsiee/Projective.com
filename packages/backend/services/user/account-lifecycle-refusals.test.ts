import { assertEquals } from "@std/assert";
import { blockersFrom, lifecycleFailure } from "./account-lifecycle-refusals.ts";

Deno.test("blockersFrom — keeps known codes in order, drops noise", () => {
	assertEquals(blockersFrom("wallet_balance, live_work,nonsense"), ["wallet_balance", "live_work"]);
	assertEquals(blockersFrom(null), []);
});

Deno.test("lifecycleFailure — a blocked schedule leads with its first blocker", () => {
	const res = lifecycleFailure({
		message: "blocked",
		code: "P0001",
		details: "escrow_held,live_work",
	});
	assertEquals(res.status, 409);
	assertEquals(res.details?.refusal, "blocked");
	assertEquals(res.details?.blockers, "escrow_held,live_work");
	assertEquals(res.message, "Money is held in escrow for or by you. Let it release first.");
});

Deno.test("lifecycleFailure — a handle refusal carries the namespace rule's sentence", () => {
	const res = lifecycleFailure({
		message: "handle_refused",
		code: "P0001",
		details: "That handle is taken.",
	});
	assertEquals(res.status, 422);
	assertEquals(res.errors?.handle, "That handle is taken.");
});

Deno.test("lifecycleFailure — refusal codes, auth and outages map distinctly", () => {
	assertEquals(lifecycleFailure({ message: "handle_locked", code: "P0001" }).status, 409);
	assertEquals(
		lifecycleFailure({ message: "confirmation_mismatch", code: "P0001" }).errors?.confirmation,
		"Type CONFIRM exactly to confirm.",
	);
	assertEquals(lifecycleFailure({ message: "not_authenticated", code: "28000" }).status, 401);
	assertEquals(lifecycleFailure({ message: "profile_required", code: "42501" }).status, 403);
	const outage = lifecycleFailure({ message: "function does not exist", code: "42883" });
	assertEquals(outage.status, 503);
	assertEquals(outage.details?.reason, "function does not exist");
});
