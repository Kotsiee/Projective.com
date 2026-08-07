import type { ExploreItem } from "@projective/types/explore";
import type { AddBasketItem, PurchasableItemKind } from "../types/checkout-types.ts";

/**
 * purchasable — the ONE mapping from a discovery listing to the SSOT's {@link PurchasableItemKind},
 * and to the {@link AddBasketItem} payload every "Add to basket" / "Buy now" trigger sends.
 *
 * It exists because three surfaces put an item into a basket — the entity-view action lane, the ≤767px
 * buy bar, and the Buy-Now modal — and a second copy of this switch is how one of them comes to add a
 * `one_off_service` where the others add a `single_service_task`. The dedupe in the fat service keys on
 * `(itemType, itemId, stageId)`, so two surfaces disagreeing about `itemType` would stack two lines for
 * the same listing rather than incrementing one.
 *
 * Pure: no state, no DOM, no money. Safe from a server resolver and from an island.
 */

// #region Kind mapping
/**
 * The purchasable kind a discovery listing is bought as, or `null` when the listing is not itself a
 * purchasable (a profile, a project posting, an article — those are engaged with, not bought).
 *
 * The five service delivery models map onto the five service/session kinds of the SSOT enum
 * (root CLAUDE.md Decision #45); a product is always a digital deliverable.
 */
export function purchasableKindOf(item: ExploreItem): PurchasableItemKind | null {
	if (item.type === "products") return "digital_product";
	if (item.type !== "services") return null;
	switch (item.serviceType) {
		case "Pipeline":
			return "service_ticket";
		case "One-Off":
			return "one_off_service";
		case "Direct Deliverable":
			return "single_service_task";
		case "Session":
			return "service_session";
		case "Group Session":
			return "course_group_session";
		default:
			return null;
	}
}
// #endregion

// #region Add payload
/**
 * The add-to-basket payload for a discovery listing, or `null` when it is not purchasable.
 *
 * **The `metadata.serviceId` it stamps is load-bearing, not decoration.** It is the token the fat
 * service's `narrow()` filters a checkout on (`?service_id=`), and it is the ONLY line-scoping facility
 * the shipped `CheckoutSessionContext` contract has — which is what makes a single-listing instant
 * checkout priceable without either re-totalling client-side (forbidden) or silently de-selecting the
 * buyer's other lines (destructive). For a SERVICE the fat fixtures already derive exactly this value
 * from the discovery corpus, so stamping it changes nothing; for a PRODUCT they derive none, so
 * stamping it is what isolates the line. It never changes how a line groups: `buildGroups` buckets
 * every product under one `product` key regardless.
 *
 * `basketId: null` lands the line in the acting account's default basket, so an add from anywhere on
 * the platform needs no prior lookup.
 */
export function addPayloadFor(item: ExploreItem, basketId: string | null): AddBasketItem | null {
	const itemType = purchasableKindOf(item);
	if (!itemType) return null;
	return {
		basketId,
		itemType,
		itemId: item.id,
		quantity: 1,
		metadata: { serviceId: item.id, sourceType: item.type },
	};
}
// #endregion
