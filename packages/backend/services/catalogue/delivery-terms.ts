import { DELIVERY_TERMS_KEY } from "@projective/types/catalogue";
import { getUserClient } from "../../core/supabase.ts";

/**
 * delivery-terms — the buyer's A8 acknowledgement, written onto their own basket lines (Decision #488).
 *
 * The checkout's Pay is gated on a box that says a file counts as downloaded once it has been
 * delivered in full. Ticking it is the buyer's act, so it is written under THEIR session, onto the
 * product lines they are paying for (`finance.basket_items.metadata.deliveryTermsAccepted`), before any
 * money moves. `finance.place_wallet_order` reads it inside the purchase and stamps
 * `catalogue.entitlements.delivery_terms_accepted_at`; because it rides the basket line, a card payment
 * the Stripe webhook completes carries it exactly as a wallet payment does.
 *
 * Recording only. A line paid without the tick still sells; its entitlement simply records no
 * acceptance, and the refund rule never treats such a line as downloaded.
 */

/**
 * Mark each of these basket lines as accepted. Lines the caller cannot write (RLS) are skipped. Never
 * throws: a failure means the acceptance is not recorded, which is the buyer-safe outcome.
 */
export async function acceptDeliveryTerms(
	accessToken: string,
	lineIds: readonly string[],
): Promise<void> {
	if (lineIds.length === 0) return;
	try {
		const db = getUserClient(accessToken).schema("finance");
		const { data, error } = await db.from("basket_items").select("id, metadata").in("id", [
			...lineIds,
		]);
		if (error) return;
		for (const row of (data ?? []) as { id: string; metadata: Record<string, unknown> | null }[]) {
			if (row.metadata?.[DELIVERY_TERMS_KEY] === true) continue;
			await db.from("basket_items")
				.update({ metadata: { ...(row.metadata ?? {}), [DELIVERY_TERMS_KEY]: true } })
				.eq("id", row.id);
		}
	} catch (error) {
		console.error("[catalogue:delivery-terms]", error instanceof Error ? error.message : error);
	}
}
