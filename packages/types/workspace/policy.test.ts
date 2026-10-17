import { assertEquals } from "@std/assert";
import { evaluateSpend, type SpendVerdict } from "./policy.ts";

/**
 * `evaluateSpend` is the one pre-flight of the business spend gate (`finance.fn_assert_business_spend`,
 * Decision #240). Each refusal carries the sub-code the database would raise for the same spend, in
 * the order the database checks it, so the checkout words a refusal before Pay exactly as it would
 * word the database's after it (Decision #243).
 */

// #region Fixtures
const VERIFIED = { approvalThresholdMinor: 500_000, verification: "verified" as const };
const SPENDER = { canSpend: true, limitMinor: 1_700_000, perTransactionMinor: 1_000_000 };

function codeOf(verdict: SpendVerdict): string | null {
	return verdict.outcome === "allowed" ? null : verdict.code;
}
// #endregion

Deno.test("evaluateSpend: an unverified business is blocked as kyb_required before anything else", () => {
	const verdict = evaluateSpend(10_000_000, { ...SPENDER, canSpend: false }, {
		...VERIFIED,
		verification: "unverified",
	});
	assertEquals(verdict.outcome, "blocked");
	assertEquals(codeOf(verdict), "kyb_required");
});

Deno.test("evaluateSpend: a member without the spend right is blocked as no_spend", () => {
	assertEquals(codeOf(evaluateSpend(100, { ...SPENDER, canSpend: false }, VERIFIED)), "no_spend");
	assertEquals(codeOf(evaluateSpend(100, undefined, VERIFIED)), "no_spend");
});

Deno.test("evaluateSpend: over the per-transaction ceiling is over_limit, checked before the cap", () => {
	const verdict = evaluateSpend(1_000_001, SPENDER, VERIFIED);
	assertEquals(verdict.outcome, "needs_approval");
	assertEquals(codeOf(verdict), "over_limit");
});

Deno.test("evaluateSpend: over the remaining cap is over_limit", () => {
	const verdict = evaluateSpend(400_000, { ...SPENDER, limitMinor: 300_000 }, VERIFIED);
	assertEquals(verdict.outcome, "needs_approval");
	assertEquals(codeOf(verdict), "over_limit");
});

Deno.test("evaluateSpend: at or above the threshold, inside the envelope, is needs_approval", () => {
	assertEquals(codeOf(evaluateSpend(500_000, SPENDER, VERIFIED)), "needs_approval");
	assertEquals(codeOf(evaluateSpend(900_000, SPENDER, VERIFIED)), "needs_approval");
});

Deno.test("evaluateSpend: under the threshold and inside the envelope is allowed", () => {
	assertEquals(evaluateSpend(499_999, SPENDER, VERIFIED), { outcome: "allowed" });
	assertEquals(
		evaluateSpend(5_000_000, { canSpend: true, limitMinor: null, perTransactionMinor: null }, {
			approvalThresholdMinor: null,
			verification: "verified",
		}),
		{ outcome: "allowed" },
	);
});
