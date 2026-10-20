/**
 * protection-terms — whether "Payment protection" may link its terms (`flows/LANDING.md` §4.6, §9
 * row 8). The link goes to the legal hub's payment protection terms (`/legal/escrow-terms`, which
 * shows the version in effect today), and it renders only once a lawyer has reviewed that version:
 * a draft ("Draft — pending legal review", `reviewedAt: null`) is never offered as the terms that
 * protect a payment. Server-only: it reads the legal content registry.
 */
import type { LegalSlug } from "@projective/types/content";
import {
	currentVersion,
	type LegalFamily,
	legalFamily,
	legalToday,
} from "@features/legal/core/registry.ts";
import { legalDocumentHref } from "@features/legal/core/versions.ts";

// #region Terms link
/** The payment protection terms: the legal hub's escrow terms, a registered document. */
export const PROTECTION_TERMS_SLUG: LegalSlug = "escrow-terms";

/**
 * The address "Read the payment protection terms" links to, or `null` while the version in effect
 * on `today` (`YYYY-MM-DD`, UTC) has no lawyer's review (`reviewedAt` is `null`) or the document is
 * not registered — then the section renders no terms link (§9 row 8).
 *
 * @param family The terms' versions; the registry's escrow terms unless a test passes its own.
 * @param today The day the version in effect is chosen on; today in UTC by default.
 */
export function protectionTermsHref(
	family: LegalFamily | undefined = legalFamily(PROTECTION_TERMS_SLUG),
	today: string = legalToday(),
): string | null {
	if (!family) return null;
	return currentVersion(family, today).reviewedAt ? legalDocumentHref(family.slug) : null;
}
// #endregion
