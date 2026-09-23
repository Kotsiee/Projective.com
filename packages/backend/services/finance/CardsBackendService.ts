import { z } from "zod";
import type { SaveCardInput, SavedCard } from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import type { BasketQuery } from "./basket-query.ts";
import { resolveOwner } from "./commerce-owner.ts";
import * as live from "./live-cards.ts";

/**
 * CardsBackendService — the FAT half of the saved-cards surface: list · save · set-default · remove,
 * each returning a transport-agnostic {@link ServiceResult}, read and written LIVE over
 * `finance.saved_cards` as the signed-in caller.
 *
 * ⚠️ **This service never sees a card number.** A card is collected by the payment processor in an
 * iframe this application does not script, and only the resulting opaque reference reaches
 * {@link save}. The brand, last four and expiry are the processor's to report — a client that could
 * supply them could mislabel a card — which is why `finance.saved_cards` has no client INSERT policy
 * and its display columns are immutable. Until the processor's tokenisation handshake is connected,
 * {@link save} refuses plainly instead of inventing a card.
 *
 * **Cards are scoped to the acting account, like the basket.** A personal card and an entity's
 * business card live in different scopes, and only a member with `manage_billing` may change an
 * entity's cards — the RLS policies say so, and a write that matched nothing is reported as the
 * refusal it is.
 */

// #region Local payloads
/** Make one card the account's default. */
export const SetDefaultCardSchema = z.object({
	cardId: z.string().min(1).max(120),
});
export type SetDefaultCardInput = z.infer<typeof SetDefaultCardSchema>;

/** Remove a card from the account. */
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
	/** The card a write just changed; absent on a plain list. */
	card?: SavedCard;
}

const SIGNED_OUT = fail(401, { message: "Sign in to see your saved cards." });
const UNREACHABLE = fail(503, {
	message: "We couldn't reach your saved cards just now. Try again in a moment.",
});

export class CardsBackendService {
	/** Every card on file for the acting account, default first. */
	static async list(query: BasketQuery, actor: ReadActor): Promise<ServiceResult<CardsPayload>> {
		try {
			const owner = await resolveOwner(query, actor);
			if (!owner) return SIGNED_OUT;
			const cards = await live.listCards(owner, actor);
			return ok({ cards, defaultCardId: live.defaultCardOf(cards, owner) });
		} catch (error) {
			console.error("[cards]", error instanceof Error ? error.message : error);
			return UNREACHABLE;
		}
	}

	/**
	 * Register a tokenised card against the acting account.
	 *
	 * Refused until the payment processor is connected: a card row is the processor's report of an
	 * instrument it holds, and there is no processor here to hold one. Writing a row from the request
	 * alone would put a card on file that nothing can ever charge.
	 */
	static save(
		_input: SaveCardInput,
		_query: BasketQuery,
		_actor: ReadActor,
	): Promise<ServiceResult<CardsPayload>> {
		return Promise.resolve(fail(501, {
			message:
				"Cards are added through the payment processor, which isn't connected in this environment.",
		}));
	}

	/** Make one card the account's default. An expired card is refused rather than silently accepted. */
	static setDefault(
		input: SetDefaultCardInput,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<CardsPayload>> {
		return write(query, actor, (owner) => live.setDefaultCard(input.cardId, owner, actor), input.cardId);
	}

	/**
	 * Remove a card. Removing the default promotes the next usable card, so an account is never left
	 * with cards on file and none selected.
	 */
	static remove(
		input: RemoveCardInput,
		query: BasketQuery,
		actor: ReadActor,
	): Promise<ServiceResult<CardsPayload>> {
		return write(query, actor, (owner) => live.removeCard(input.cardId, owner, actor), null);
	}
}

// #region Internals
/** Run a card write and answer with the refreshed list, the way every read answers. */
async function write(
	query: BasketQuery,
	actor: ReadActor,
	run: (owner: NonNullable<Awaited<ReturnType<typeof resolveOwner>>>) => Promise<live.CardOutcome>,
	changedId: string | null,
): Promise<ServiceResult<CardsPayload>> {
	try {
		const owner = await resolveOwner(query, actor);
		if (!owner) return SIGNED_OUT;
		const out = await run(owner);
		if (!out.ok) return fail(out.status, { message: out.message });
		const cards = await live.listCards(owner, actor);
		const card = changedId ? cards.find((c) => c.id === changedId) : undefined;
		return ok(
			{ cards, defaultCardId: live.defaultCardOf(cards, owner), ...(card ? { card } : {}) },
			{ message: out.message },
		);
	} catch (error) {
		console.error("[cards]", error instanceof Error ? error.message : error);
		return UNREACHABLE;
	}
}
// #endregion
