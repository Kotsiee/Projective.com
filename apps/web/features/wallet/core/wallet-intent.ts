import {
	safeWalletBack,
	WALLET_BACK_BILLING,
	WALLET_BACK_OVERVIEW,
	WALLET_INTENT_ACTIONS,
	type WalletAction,
} from "@projective/types/finance";

/**
 * wallet-intent — a link INTO a wallet action, and the way back out (Decision #243).
 *
 * `/wallet?w=<scope>:<id>&do=<action>&back=<path>` opens that wallet with the action's dialog already
 * open — the checkout's "Add money" opens the business wallet's top-up — and, once the movement is
 * done, offers to go back to `back`. The action is an INTENT, not a command: the wallet still offers
 * only the actions the viewer holds, and a locked one opens with its reason. Pure, so the checkout
 * builds the link and the wallet reads it with the same rules.
 *
 * `back` is an open-redirect surface, so it is allowlisted: a same-origin path under `/checkout`, a
 * business console's Billing module (`/businesses/:handle/billing` — its Top up, Decision #247), or a
 * business console's Overview (`/businesses/:handle` — its setup hero's Add money, Decision #248), and
 * nothing else. The allowlist and the action set live beside `WalletPageQuerySchema` in
 * `@projective/types/finance`; widen them there deliberately when another flow needs a way back, and
 * give it a label in {@link backLabelFor}.
 */

// #region Params
/** The query param naming the action to open. */
export const WALLET_INTENT_PARAM = "do";
/** The query param naming where "done" returns to. */
export const WALLET_BACK_PARAM = "back";

// #endregion

// #region Build & read
/** A same-origin path the wallet may send the viewer back to, or `null` ({@link safeWalletBack}). */
export const safeBack = safeWalletBack;

/** The label of a finished movement's way back to `back` (an allowlisted path): where it returns to. */
export function backLabelFor(back: string): string {
	if (WALLET_BACK_BILLING.test(back)) return "Back to billing";
	if (WALLET_BACK_OVERVIEW.test(back)) return "Back to overview";
	return "Back to checkout";
}

/** The wallet link that opens `action` on `wallet` (`business:<id>`), returning to `back` when done. */
export function walletIntentHref(
	wallet: string,
	action: WalletAction,
	back: string | null,
): string {
	const params = new URLSearchParams();
	if (wallet && wallet !== "personal") params.set("w", wallet);
	params.set(WALLET_INTENT_PARAM, action);
	const safe = safeBack(back);
	if (safe) params.set(WALLET_BACK_PARAM, safe);
	return `/wallet?${params.toString()}`;
}

/** The intent a wallet address carries: the action to open and where to go back to, each validated. */
export function walletIntentOf(
	params: URLSearchParams,
): { action: WalletAction | null; back: string | null } {
	const raw = params.get(WALLET_INTENT_PARAM);
	const action = raw && WALLET_INTENT_ACTIONS.has(raw as WalletAction) ? raw as WalletAction : null;
	return { action, back: safeBack(params.get(WALLET_BACK_PARAM)) };
}
// #endregion
