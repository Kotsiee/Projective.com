import { assertEquals } from "@std/assert";
import { freelancerUnlockFailure } from "./freelancer-unlock.ts";

Deno.test("freelancerUnlockFailure — 28000 is a lapsed session (401)", () => {
	const result = freelancerUnlockFailure({ code: "28000", message: "Not authenticated" });
	assertEquals(result.ok, false);
	assertEquals(result.status, 401);
});

Deno.test("freelancerUnlockFailure — 42501 is incomplete onboarding (403)", () => {
	const result = freelancerUnlockFailure({ code: "42501" });
	assertEquals(result.status, 403);
	assertEquals(result.message?.includes("Finish setting up your account"), true);
});

Deno.test("freelancerUnlockFailure — 22023 is a refused skill list, keyed to the field (422)", () => {
	const result = freelancerUnlockFailure({
		code: "22023",
		message: "Unknown skill: basket-weaving",
	});
	assertEquals(result.status, 422);
	assertEquals(result.errors, { skills: "Unknown skill: basket-weaving" });
});

Deno.test("freelancerUnlockFailure — anything else is an outage, never a success", () => {
	for (const code of ["23514", "P0001", undefined]) {
		const result = freelancerUnlockFailure({ code });
		assertEquals(result.ok, false);
		assertEquals(result.status, 503);
	}
});
