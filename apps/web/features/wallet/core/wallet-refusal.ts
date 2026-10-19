import { BUSINESS_NOT_ACTIVE_REASON } from "@projective/types/workspace";
import { BUSINESS_REFUSAL_COPY } from "@features/workspaces/core/refusal-copy.ts";

/**
 * wallet-refusal — what a wallet money dialog says when the server refused the movement. Pure, so the
 * dialogs stay dumb and the wording is unit-tested.
 */

/** The parts of a wallet action's soft result a refusal is worded from. */
export interface WalletRefusal {
	message?: string;
	errors?: Record<string, string>;
	details?: Record<string, string | number | boolean | null>;
}

/** What the sentence may name. */
export interface WalletRefusalContext {
	/**
	 * The names of the business wallets the movement touched, by business id — the source and, for a
	 * transfer, the destination — so a refusal names the business it is about.
	 */
	businesses?: Readonly<Record<string, string>>;
	/**
	 * The ids of those businesses the reader owns (their wallet role is `owner`) — the one who
	 * publishes or restores it, so the ask names the act instead of "ask the owner".
	 */
	owned?: readonly string[];
}

/**
 * A wallet movement's refusal in the reader's words. A draft or archived business's refusal
 * (`details.reason` `business_not_active` — the spend gate's, or an archived business taking no money
 * in, Decision #248 (k)) is worded from the business refusal map (Decision #243): its sentence, naming
 * the business when the movement touched it, then the ask its status needs ("Ask the owner to restore
 * it." for an archived one; "Restore it first." when the reader owns it). Anything else is the
 * server's own message, else its first field error, else `fallback`.
 */
export function walletRefusalSentence(
	res: WalletRefusal | null | undefined,
	ctx: WalletRefusalContext,
	fallback: string,
): string {
	const details = res?.details;
	if (details?.reason === BUSINESS_NOT_ACTIVE_REASON) {
		const id = typeof details.businessId === "string" ? details.businessId : null;
		const copy = BUSINESS_REFUSAL_COPY.business_not_active;
		const refusal = {
			business: id ? ctx.businesses?.[id] ?? null : null,
			businessStatus: typeof details.status === "string" ? details.status : null,
			ownsBusiness: id !== null && (ctx.owned?.includes(id) ?? false),
		};
		return `${copy.sentence(refusal)} ${copy.ask(refusal)}`;
	}
	return res?.message ?? Object.values(res?.errors ?? {})[0] ?? fallback;
}
