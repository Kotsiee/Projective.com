import type { WalletAction } from "@projective/types/finance";

/**
 * wallet-intent — a link INTO a wallet action, and the way back out (Decision #243).
 *
 * `/wallet?w=<scope>:<id>&do=<action>&back=<path>` opens that wallet with the action's dialog already
 * open — the checkout's "Add money" opens the business wallet's top-up — and, once the movement is
 * done, offers to go back to `back`. The action is an INTENT, not a command: the wallet still offers
 * only the actions the viewer holds, and a locked one opens with its reason. Pure, so the checkout
 * builds the link and the wallet reads it with the same rules.
 *
 * `back` is an open-redirect surface, so it is allowlisted: a same-origin path under `/checkout` only.
 * Widen {@link BACK_PREFIXES} deliberately when another flow needs a way back.
 */

// #region Params
/** The query param naming the action to open. */
export const WALLET_INTENT_PARAM = "do";
/** The query param naming where "done" returns to. */
export const WALLET_BACK_PARAM = "back";

/** The paths a wallet intent may return to. */
const BACK_PREFIXES: readonly string[] = ["/checkout"];

/** The actions a link may open — the wallet's own movement and configuration dialogs. */
const INTENT_ACTIONS: ReadonlySet<WalletAction> = new Set<WalletAction>([
	"top_up",
	"withdraw",
	"transfer",
	"distribute",
	"fund_escrow",
	"new_recurring",
	"add_method",
	"set_payout",
	"enrol_smoother",
]);
// #endregion

// #region Build & read
/**
 * A same-origin path the wallet may send the viewer back to, or `null`: it must start with one
 * allowlisted prefix followed by `/`, `?`, `#` or nothing, and carry no scheme, no protocol-relative
 * `//`, no backslash and no control character.
 */
export function safeBack(raw: string | null | undefined): string | null {
	const path = raw?.trim() ?? "";
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
	if ([...path].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;
	const allowed = BACK_PREFIXES.some((prefix) =>
		path === prefix ||
		["/", "?", "#"].includes(path.charAt(prefix.length)) && path.startsWith(prefix)
	);
	return allowed && path.length <= 600 ? path : null;
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
	const action = raw && INTENT_ACTIONS.has(raw as WalletAction) ? raw as WalletAction : null;
	return { action, back: safeBack(params.get(WALLET_BACK_PARAM)) };
}
// #endregion
