import type { CheckoutResult } from "@projective/types/finance";

/**
 * Whether a card step is mid-handoff. While it is, the card panel owns the page's one tier-1 commit
 * and the rail's Buy Now steps out (DESIGN_SYSTEM §B.8.2, Decision #157).
 */
export function cardStepPending(
	result: Pick<CheckoutResult, "status" | "payment"> | null,
): boolean {
	return result !== null && result.status === "requires_action" && result.payment !== undefined;
}
