import type { RankedContact } from "@projective/types/messaging";

/** How many people a Share row's flyout offers (Decision #400). */
export const RECENT_RECIPIENTS = 3;

/**
 * The people last talked to or worked with, newest first. The picker's ranking orders by relationship
 * tier, so a teammate never messaged would lead it; here only a real last interaction counts.
 */
export function recentRecipients(
	contacts: readonly RankedContact[],
	count = RECENT_RECIPIENTS,
): RankedContact[] {
	const at = (c: RankedContact) => Date.parse(c.lastInteractionAt ?? "");
	const known = contacts.filter((c) => Number.isFinite(at(c)));
	return known.sort((a, b) => at(b) - at(a)).slice(0, count);
}
