import { z } from "zod";
import type { SaveCardInput, SavedCard } from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isFinanceBackendLive } from "../../core/supabase.ts";
import type { BasketQuery } from "./basket-query.ts";
import { resolveOwner } from "./basket-fixtures.ts";
import * as fx from "./cards-fixtures.ts";

/**
 * CardsBackendService — the FAT half of the saved-cards surface: list · save · set-default · remove,
 * each returning a transport-agnostic {@link ServiceResult}.
 *
 * ⚠️ **This service never sees a card number.** A card is collected by Stripe Elements in an iframe
 * this application does not script, and only the resulting opaque `stripePaymentMethodId` reaches
 * {@link save}. The brand, last4 and expiry are read back from Stripe SERVER-side rather than accepted
 * from the caller — a client that could supply them could mislabel a card. `SaveCardInputSchema` has no
 * PAN or CVV field to populate, so the boundary is structural, not a convention.
 *
 * **Cards are scoped to the acting account, like the basket.** A personal card and an entity's business
 * card live in different scopes; a non-member is refused with a reason, and `isBusinessCard` may only be
 * set on an entity scope — otherwise a personal card could masquerade as one and pass the entity
 * payment gate the SSOT's `availableProviders` enforces.
 *
 * Gated by {@link isFinanceBackendLive} (`FINANCE_BACKEND_LIVE`, default off): until the RLS-scoped
 * `finance.saved_cards` table, its mutation policies and the Stripe PaymentMethod attach/detach calls
 * are wired, reads answer from deterministic fixtures and writes mutate an in-module session store.
 */

// #region Local payloads (shapes the frozen SSOT does not yet carry)
/**
 * Make one card the account's default.
 *
 * The finance SSOT carries `SaveCardInputSchema` but no set-default or remove payload, so both are
 * declared here beside their only consumer rather than invented separately in each route. **They belong
 * in `@projective/types/finance/checkout.ts`** and should move there when that contract is next opened
 * — flagged, not silently forked.
 */
export const SetDefaultCardSchema = z.object({
	cardId: z.string().min(1).max(120),
});
export type SetDefaultCardInput = z.infer<typeof SetDefaultCardSchema>;

/** Detach a card from the account. See the note on {@link SetDefaultCardSchema}. */
export const RemoveCardSchema = z.object({
	cardId: z.string().min(1).max(120),
});
export type RemoveCardInput = z.infer<typeof RemoveCardSchema>;
// #endregion

/** What a cards read/write returns: the account's cards plus the one a payment pre-selects. */
export interface CardsPayload {
	cards: SavedCard[];
	/** The card a card payment would use; `null` when none is usable for this account. */
	defaultCardId: string | null;
	/** The card a write just created or changed; absent on a plain list. */
	card?: SavedCard;
}

export class CardsBackendService {
	/** Every card on file for the acting account, default first. */
	static list(query: BasketQuery): ServiceResult<CardsPayload> {
		if (isFinanceBackendLive()) {
			// LIVE: `select … from finance.saved_cards where owner_type = $1 and owner_id = $2` under the
			// caller's JWT (RLS scopes it) — not yet implemented; fall back to fixtures.
		}
		const owner = resolveOwner(query);
		return ok({
			cards: fx.listCards(owner, query.sim?.cards),
			defaultCardId: fx.defaultCardId(owner, query.sim?.cards),
		});
	}

	/**
	 * Register a tokenised card against the acting account. The payload carries the Stripe reference
	 * only; the display fragments are resolved server-side.
	 */
	static save(input: SaveCardInput, query: BasketQuery): ServiceResult<CardsPayload> {
		return fold(fx.saveCard(input, resolveOwner(query)), query);
	}

	/** Make one card the account's default. An expired card is refused rather than silently accepted. */
	static setDefault(input: SetDefaultCardInput, query: BasketQuery): ServiceResult<CardsPayload> {
		return fold(fx.setDefaultCard(input.cardId, resolveOwner(query)), query);
	}

	/**
	 * Detach a card. Removing the default promotes the next usable card, so an account is never left
	 * with cards on file and none selected.
	 */
	static remove(input: RemoveCardInput, query: BasketQuery): ServiceResult<CardsPayload> {
		return fold(fx.removeCard(input.cardId, resolveOwner(query)), query);
	}
}

// #region Internals
/** Fold a fixtures {@link fx.CardOutcome} into a {@link ServiceResult}. */
function fold(out: fx.CardOutcome, query: BasketQuery): ServiceResult<CardsPayload> {
	if (!out.ok) return fail(out.status ?? 422, { message: out.message });
	const owner = resolveOwner(query);
	return ok({
		cards: out.cards ?? fx.listCards(owner, query.sim?.cards),
		defaultCardId: fx.defaultCardId(owner, query.sim?.cards),
		card: out.card,
	}, { message: out.message });
}
// #endregion
