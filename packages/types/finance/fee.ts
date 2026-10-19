/**
 * finance fee — the platform service fee as a dependency-free leaf: the canonical rate and the ONE
 * truncating fee function every surface computes a fee with (Decision #187). `checkout.ts` re-exports
 * both, so `@projective/types/finance` still carries them; a client surface that needs only the fee
 * (the landing's lazy demos) imports this module by its own path (`@projective/types/finance/fee`),
 * so the bundler never keeps the fee inside the shared chunk the checkout schemas live in.
 */

// #region Platform fee
/**
 * The canonical platform service fee in basis points — **500 bp = 5% flat** (CLAUDE.md §8 Decision #2;
 * `finance-model.md` §1.1 is canonical, and `investor-summary.md`'s 10% was corrected against it).
 * Stripe processing costs are passed through separately and are never folded into this number.
 *
 * The live authority is `security.platform_params.platform_fee_bp`, resolved per payer through
 * `finance.fn_effective_platform_fee_bp` (which lets a negotiated rate override it). A preview takes the
 * effective rate from the server DTO (`finance.get_purchase_owner`'s `platform_fee_bp`); this constant
 * is only a DISPLAY fallback for a surface that has no payer in hand, and a unit test pins it to the
 * seeded param (Decision #187).
 */
export const PLATFORM_FEE_BP = 500;

/**
 * The platform service fee on a discounted base, in integer minor units.
 *
 * Charged on what is actually transacted (post-discount), TRUNCATED to the minor unit exactly once —
 * the integer division every SQL fee path runs (`(amount * bp) / 10000`, Decision #187). Pass the
 * payer's resolved rate (`finance.fn_effective_platform_fee_bp`) when one is in hand; otherwise the
 * display fallback {@link PLATFORM_FEE_BP} applies.
 */
export function platformFeeFor(baseMinor: number, feeBp: number = PLATFORM_FEE_BP): number {
	if (baseMinor <= 0 || feeBp <= 0) return 0;
	return Math.floor((baseMinor * feeBp) / 10_000);
}
// #endregion
