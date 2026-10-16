import { assertEquals } from "@std/assert";
import {
	type AccessTokenClaims,
	GUEST_CONTEXT,
	parseOperatorModeOverride,
	PERSONAL_MEMBER_CONTEXT,
	resolveUserContext,
} from "./user-context.ts";

/** A minimal claims payload with `active_context` set to whatever the case under test needs. */
function claims(active: Record<string, unknown> | undefined): AccessTokenClaims {
	return {
		sub: "8f14e45f-ceea-467a-9c9a-1f1f1f1f1f1f",
		app_metadata: active ? { active_context: active } : {},
	};
}

// #region onboarded — the three states, and why only one of them gates
Deno.test("a token whose hook said the profile exists resolves onboarded", () => {
	assertEquals(resolveUserContext(claims({ onboarded: true })).onboarded, true);
});

Deno.test("a token whose hook LOOKED and found no profile resolves un-onboarded", () => {
	assertEquals(resolveUserContext(claims({ onboarded: false })).onboarded, false);
});

Deno.test("an ABSENT claim is onboarded, never unknown-treated-as-missing", () => {
	// The failure this pins is the expensive one: a token minted before the claim existed, or one
	// whose hook hit its EXCEPTION handler and returned the event unchanged, must not send a fully
	// set-up user back through onboarding. Every shape below is "nobody said".
	assertEquals(resolveUserContext(claims({})).onboarded, true, "empty active_context");
	assertEquals(resolveUserContext(claims(undefined)).onboarded, true, "no active_context at all");
	assertEquals(resolveUserContext({ sub: "u1" }).onboarded, true, "bare token");
});

Deno.test("only a boolean false gates — a truthy-looking non-boolean does not", () => {
	// `!active.onboarded` would make every one of these un-onboarded. The resolver compares against
	// `false` precisely so a malformed claim degrades to "nobody said".
	for (const value of [undefined, null, 0, "", "false", "no"]) {
		assertEquals(
			resolveUserContext(claims({ onboarded: value })).onboarded,
			true,
			`${JSON.stringify(value)} is not a confirmed absence`,
		);
	}
});

Deno.test("neither default context asserts an unfinished onboarding", () => {
	// A guest has no identity to onboard, and the opaque-cookie fallback decoded no claims at all —
	// both would bounce every request they describe if either said false.
	assertEquals(GUEST_CONTEXT.onboarded, true);
	assertEquals(PERSONAL_MEMBER_CONTEXT.onboarded, true);
});
// #endregion

// #region restricted — only an explicit true restricts
Deno.test("a token whose hook found a 13–17 profile resolves restricted", () => {
	assertEquals(resolveUserContext(claims({ isRestricted: true })).restricted, true);
});

Deno.test("an absent or non-boolean restriction claim reads unrestricted", () => {
	for (const value of [undefined, null, false, 1, "true"]) {
		assertEquals(
			resolveUserContext(claims({ isRestricted: value })).restricted,
			false,
			String(value),
		);
	}
	assertEquals(GUEST_CONTEXT.restricted, false);
	assertEquals(PERSONAL_MEMBER_CONTEXT.restricted, false);
});
// #endregion

// #region isOperator — operator mode, the Teams persona gate's second fact (Decision #228 (A))
Deno.test("a token whose hook stamped operator mode resolves isOperator", () => {
	const ctx = resolveUserContext(claims({ isFreelancer: true, isClient: true, isOperator: true }));
	assertEquals([ctx.isFreelancer, ctx.isOperator], [true, true]);
});

Deno.test("an absent or non-boolean operator claim reads false, and an enterprise is never an operator", () => {
	for (const value of [undefined, null, false, 1, "true"]) {
		assertEquals(
			resolveUserContext(claims({ isOperator: value })).isOperator,
			false,
			String(value),
		);
	}
	assertEquals(
		resolveUserContext(claims({ type: "enterprise", isOperator: true })).isOperator,
		false,
	);
	assertEquals(GUEST_CONTEXT.isOperator, false);
	assertEquals(PERSONAL_MEMBER_CONTEXT.isOperator, false);
});

Deno.test("the operator-mode dev override reads only `on` and `off`", () => {
	assertEquals(parseOperatorModeOverride("on"), "on");
	assertEquals(parseOperatorModeOverride(" off "), "off");
	for (const raw of [undefined, null, "", "true", "ON"]) {
		assertEquals(parseOperatorModeOverride(raw), null);
	}
});
// #endregion
