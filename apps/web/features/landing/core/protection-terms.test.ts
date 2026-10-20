/**
 * protection-terms.test — "Read the payment protection terms" renders only for a reviewed version
 * (`flows/LANDING.md` §9 row 8): a draft is never offered as the terms behind a payment.
 */
import { assertEquals } from "@std/assert";
import type { LegalDoc } from "@projective/types/content";
import { type LegalFamily, legalFamily } from "@features/legal/core/registry.ts";
import { PROTECTION_TERMS_SLUG, protectionTermsHref } from "./protection-terms.ts";

// #region Fixtures
/** The registry's escrow terms with the version in effect on `today` re-stamped `reviewedAt`. */
function reviewedFamily(reviewedAt: string | null, today: string): LegalFamily {
	const family = legalFamily(PROTECTION_TERMS_SLUG);
	if (!family) throw new Error("the escrow terms are registered");
	const current = family.versions.findIndex((doc) => doc.effectiveDate <= today);
	const at = current === -1 ? family.versions.length - 1 : current;
	return {
		...family,
		versions: family.versions.map((doc, i): LegalDoc => (i === at ? { ...doc, reviewedAt } : doc)),
	};
}
// #endregion

Deno.test("protectionTermsHref: no link while the version in effect is an unreviewed draft", () => {
	const today = "2026-10-19";
	assertEquals(protectionTermsHref(reviewedFamily(null, today), today), null);
});

Deno.test("protectionTermsHref: the canonical terms address once a lawyer has reviewed it", () => {
	const today = "2026-10-19";
	assertEquals(
		protectionTermsHref(reviewedFamily("2026-10-18", today), today),
		"/legal/escrow-terms",
	);
});

Deno.test("protectionTermsHref: an unregistered document links nowhere", () => {
	assertEquals(protectionTermsHref(undefined, "2026-10-19"), null);
});

Deno.test("protectionTermsHref: the shipped escrow terms are drafts today, so the page links none", () => {
	const family = legalFamily(PROTECTION_TERMS_SLUG);
	const reviewed = family?.versions.some((doc) => doc.reviewedAt !== null) ?? false;
	assertEquals(protectionTermsHref(), reviewed ? "/legal/escrow-terms" : null);
});
