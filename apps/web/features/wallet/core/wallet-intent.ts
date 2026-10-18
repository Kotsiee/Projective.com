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
 * `back` is an open-redirect surface, so it is allowlisted: a same-origin path under `/checkout`, or a
 * business console's Billing module (`/businesses/:handle/billing` — its Top up, Decision #247), and
 * nothing else. Widen {@link BACK_PREFIXES} / {@link BACK_PATTERNS} deliberately when another flow
 * needs a way back, and give it a label in {@link backLabelFor}.
 */

// #region Params
/** The query param naming the action to open. */
export const WALLET_INTENT_PARAM = "do";
/** The query param naming where "done" returns to. */
export const WALLET_BACK_PARAM = "back";

/** The path prefixes a wallet intent may return to. */
const BACK_PREFIXES: readonly string[] = ["/checkout"];

/**
 * Exact pages a wallet intent may return to: a business's Billing module, its handle spelled as a
 * handle is (`CreateWorkspaceInputSchema`: 3–40 lowercase letters, digits and inner hyphens), followed
 * by nothing, a query or a fragment.
 */
const BILLING_BACK = /^\/businesses\/[a-z0-9][a-z0-9-]{1,38}[a-z0-9]\/billing(?=$|[?#])/;
const BACK_PATTERNS: readonly RegExp[] = [BILLING_BACK];

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
	) || BACK_PATTERNS.some((pattern) => pattern.test(path));
	return allowed && path.length <= 600 ? path : null;
}

/** The label of a finished movement's way back to `back` (an allowlisted path): where it returns to. */
export function backLabelFor(back: string): string {
	return BILLING_BACK.test(back) ? "Back to billing" : "Back to checkout";
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
