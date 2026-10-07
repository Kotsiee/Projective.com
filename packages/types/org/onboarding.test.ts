import { assert, assertEquals } from "@std/assert";
import {
	pendingSetupSteps,
	ProfileSetupProgressRowSchema,
	SETUP_STEP_ORDER,
} from "./onboarding.ts";

Deno.test("setup progress — the RPC row parses into camelCase", () => {
	const parsed = ProfileSetupProgressRowSchema.safeParse({
		score: 40,
		completed_keys: ["account", "email_verified", "skills"],
		next_suggested_action: "add_photo",
	});
	assert(parsed.success);
	assertEquals(parsed.data, {
		score: 40,
		completedKeys: ["account", "email_verified", "skills"],
		nextSuggestedAction: "add_photo",
	});
});

Deno.test("setup progress — a finished profile has no next action", () => {
	const parsed = ProfileSetupProgressRowSchema.safeParse({
		score: 100,
		completed_keys: [...SETUP_STEP_ORDER],
		next_suggested_action: null,
	});
	assert(parsed.success);
	assertEquals(pendingSetupSteps(parsed.data), []);
});

Deno.test("setup progress — refuses an unknown step, action or out-of-range score", () => {
	const base = { score: 40, completed_keys: ["account"], next_suggested_action: null };
	assert(
		!ProfileSetupProgressRowSchema.safeParse({ ...base, completed_keys: ["login_streak"] }).success,
	);
	assert(
		!ProfileSetupProgressRowSchema.safeParse({ ...base, next_suggested_action: "spin_wheel" })
			.success,
	);
	assert(!ProfileSetupProgressRowSchema.safeParse({ ...base, score: 140 }).success);
	assert(!ProfileSetupProgressRowSchema.safeParse({ ...base, score: 40.5 }).success);
});

Deno.test("pendingSetupSteps — checklist order, whatever order the keys arrive in", () => {
	assertEquals(
		pendingSetupSteps({
			score: 50,
			completedKeys: ["avatar", "account"],
			nextSuggestedAction: "verify_email",
		}),
		["email_verified", "skills", "profile_copy", "working_hours"],
	);
});
