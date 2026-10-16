import type { UserContext } from "@projective/types/auth";
import { itemKindMeta } from "@projective/types/finance";
import type {
	BasketItem,
	CheckoutContext,
	CheckoutPreselect,
	CheckoutView,
} from "../types/checkout-types.ts";

/**
 * basket-model — the pure, presentation-agnostic helpers the `/basket` + `/checkout` islands, routes and
 * SSR resolvers share: the URL ⇄ {@link CheckoutContext} mapping, the read-context serialiser, the
 * surface vocabulary, and — the one that matters most — the SINGLE resolver for where a basket line
 * points.
 *
 * No state, no DOM, no money arithmetic. Safe to import from a server resolver and from an island.
 */

// #region Surface vocabulary
/**
 * The four steps of the checkout flow, in order.
 *
 * They are **four routes, not four modes of one route**, which is what makes the browser's own Back
 * button work through the flow and makes each step a link a buyer can be sent. It is also why the
 * stepper is a row of real anchors rather than a controlled `Steps` widget: the URL is already the
 * state, and a second copy of it in a signal is a second thing that can be wrong.
 */
export const CHECKOUT_STEPS = [
	{ step: "basket", label: "Basket", path: "/checkout" },
	{ step: "details", label: "Details", path: "/checkout/details" },
	{ step: "payment", label: "Payment", path: "/checkout/payment" },
	{ step: "confirmation", label: "Confirmation", path: "/checkout/confirmation" },
] as const satisfies readonly { step: CheckoutStep; label: string; path: string }[];

/** One step of the flow. */
export type CheckoutStep = "basket" | "details" | "payment" | "confirmation";

/** Zero-based position of a step, used to compare "before"/"after" without a second ordering. */
export function checkoutStepIndex(step: CheckoutStep): number {
	return CHECKOUT_STEPS.findIndex((entry) => entry.step === step);
}

/**
 * The step a pathname addresses.
 *
 * `/basket` resolves to `basket` so an old link, a bookmark or a shared URL still lands on the right
 * step rather than on the flow's default; the route itself redirects (see `(dashboard)/basket`).
 */
export function checkoutStepOf(pathname: string): CheckoutStep {
	if (pathname === "/checkout/details" || pathname.startsWith("/checkout/details/")) {
		return "details";
	}
	if (pathname === "/checkout/payment" || pathname.startsWith("/checkout/payment/")) {
		return "payment";
	}
	if (pathname === "/checkout/confirmation" || pathname.startsWith("/checkout/confirmation/")) {
		return "confirmation";
	}
	return "basket";
}

/**
 * Whether a step runs in the distraction-free chrome (DESIGN_SYSTEM.md Part D.6).
 *
 * Details and Payment only. The basket is a place a buyer legitimately leaves — to add one more
 * thing, to check a listing — so removing its exits would trap them in a flow they have not committed
 * to. Confirmation is *after* the commitment, and its whole job is to send the buyer somewhere
 * (a download, a project board, a calendar), so it restores the full shell.
 */
export function isFocusStep(step: CheckoutStep): boolean {
	return step === "details" || step === "payment";
}

/** The `CheckoutView` a step belongs to — kept so the existing lane/band vocabulary is unchanged. */
export function checkoutViewOf(pathname: string): CheckoutView {
	return checkoutStepOf(pathname) === "basket" ? "basket" : "checkout";
}

/** Whether a URL belongs to this feature at all — the guard every slot resolver opens with. */
export function isCheckoutPath(pathname: string): boolean {
	return pathname === "/basket" || pathname.startsWith("/basket/") ||
		pathname === "/checkout" || pathname.startsWith("/checkout/");
}

/**
 * The basket-and-lists step's href, preserving the acting owner scope.
 *
 * **Points at `/checkout`, not `/basket`.** The basket overview IS the first step of the flow, and
 * two URLs for one surface is two places a link can rot; `/basket` survives only as a redirect.
 */
export function basketHref(basketId?: string | null, owner?: string | null): string {
	return withParams("/checkout", { basket: basketId ?? null, owner: ownerParamOf(owner) });
}

/**
 * The href for a given step of the flow, optionally narrowed to one project or service.
 *
 * The narrowing params keep the SSOT's documented snake_case spelling (`project_id` / `service_id`,
 * per `CheckoutPreselect`) because a checkout link is written by hand as often as it is generated.
 */
export function checkoutStepHref(
	step: CheckoutStep,
	basketId?: string | null,
	owner?: string | null,
	preselect?: Partial<CheckoutPreselect>,
	orderId?: string | null,
): string {
	const entry = CHECKOUT_STEPS.find((e) => e.step === step) ?? CHECKOUT_STEPS[0];
	return withParams(entry.path, {
		basket: basketId ?? null,
		owner: ownerParamOf(owner),
		project_id: preselect?.projectId ?? null,
		service_id: preselect?.serviceId ?? null,
		// Only the confirmation step reads it, but carrying it here keeps one href builder rather than
		// a second one that exists solely to append a query param.
		order: step === "confirmation" ? orderId ?? null : null,
	});
}

/**
 * The payment step's href — Buy Now's destination, which skips the basket step on purpose (one
 * purchase, nothing to review). The basket drawer's "Proceed to Checkout" goes to step 1 instead
 * ({@link basketHref}, Decision #70(k)).
 */
export function checkoutHref(
	basketId?: string | null,
	owner?: string | null,
	preselect?: Partial<CheckoutPreselect>,
): string {
	return checkoutStepHref("payment", basketId, owner, preselect);
}

/** Append the non-empty params to a path, or return it unchanged. */
function withParams(path: string, params: Record<string, string | null>): string {
	const qs = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
	const q = qs.toString();
	return q ? `${path}?${q}` : path;
}

/**
 * The owner a link carries. `personal` is kept: it is only the default for a personal context, and a
 * link without it, followed while acting as a team, would open the team's basket instead.
 */
function ownerParamOf(owner?: string | null): string | null {
	return owner || null;
}
// #endregion

// #region Item deep-linking (the ONE resolver — see the deviation note)
/**
 * Where a basket line points.
 *
 * **This is the only place a basket line's destination is computed**, and it deliberately follows the
 * CODEBASE-CANONICAL routes rather than the ones the build brief named:
 *
 * | Brief                      | Canonical (used here)              | Why                                     |
 * | :------------------------- | :--------------------------------- | :-------------------------------------- |
 * | `/[handle]/products/[id]`  | `/view/[id]` · `/[handle]/view/[id]` | No `products/[id]` route exists at all. |
 * | `/projects/[id]/[stageId]` | `/projects/[projectId]/[channelId]`| The second segment is a CHANNEL id.     |
 * | `/[handle]/availability`   | `/@[handle]/availability`          | Profiles resolve under `@handle` (#3).  |
 *
 * The brief's first two paths would 404 (Decisions #3 / #22 / #41). The third is right in shape and is
 * kept, spelled with the `@` the handle namespace actually uses.
 *
 * The SERVER-supplied `href` always wins when present: the fat service resolved it from the same
 * discovery row that produced the line's title and price, so recomputing it here could only produce a
 * destination that disagrees with the row the buyer is looking at.
 */
export function itemHref(item: BasketItem): string {
	return item.href ?? `/view/${encodeURIComponent(item.itemId)}`;
}

/** The seller's canonical profile (`/@handle`), or `null` when the line carries no seller. */
export function sellerHref(item: BasketItem): string | null {
	return item.sellerHandle ? `/@${encodeURIComponent(stripAt(item.sellerHandle))}` : null;
}

/**
 * The seller-scoped listing (`/@handle/view/[id]`) — the closest canonical equivalent of the brief's
 * `/[handle]/products/[id]`. `null` without a seller handle, since the path cannot be built.
 */
export function sellerItemHref(item: BasketItem): string | null {
	const handle = item.sellerHandle;
	if (!handle) return null;
	return `/@${encodeURIComponent(stripAt(handle))}/view/${encodeURIComponent(item.itemId)}`;
}

/**
 * Where a bookable line goes to pick or change its slot: the seller's availability calendar
 * (`/@handle/availability`). `null` for a line whose kind needs no schedule.
 */
export function scheduleHref(item: BasketItem): string | null {
	if (!itemKindMeta(item.itemType).needsSchedule) return null;
	const seller = sellerHref(item);
	return seller ? `${seller}/availability` : null;
}

/**
 * Where a stage-routed line goes to choose or review its stage — the canonical project channel
 * namespace `/projects/[projectSlug]/[stageSlug]`, which resolves a `stg-` segment to the stage's own
 * room (Decision #93). The basket answers a line's stage as that slug.
 *
 * The project is the line's BOARD: a project ticket's own project, or — for a service ticket — the
 * buyer's engagement instantiated from that listing, which the basket names as `boardProjectId`.
 * `null` when the line is not stage-routed or its project is unknown.
 */
export function stageHref(item: BasketItem): string | null {
	if (!item.stageId) return null;
	const board = typeof item.metadata.boardProjectId === "string"
		? item.metadata.boardProjectId
		: typeof item.metadata.projectId === "string"
		? item.metadata.projectId
		: null;
	if (!board) return null;
	return `/projects/${encodeURIComponent(board)}/${encodeURIComponent(item.stageId)}`;
}

/** Strip a leading `@` so a handle is never double-prefixed in a URL. */
function stripAt(handle: string): string {
	return handle.startsWith("@") ? handle.slice(1) : handle;
}

/**
 * What paying for a line does with the money, in the funding line's words (Decision #165): a board
 * ticket funds whoever holds it and is held in escrow until the work is approved; a session is held
 * in escrow from checkout (PRODUCT_SPEC §Sessions). Every other kind says nothing — no escrow is
 * documented for it (Decision #70(i)). `null` for an unavailable line, which funds nothing.
 */
export function fundingNote(item: BasketItem): string | null {
	if (!item.available) return null;
	if (item.ticketId) {
		const payee = typeof item.metadata.payeeName === "string"
			? item.metadata.payeeName
			: "the assignee";
		return `Funds ${payee} to start ${item.title}. Held in escrow until you approve the work.`;
	}
	return itemKindMeta(item.itemType).needsSchedule
		? "Held in escrow until after the session."
		: null;
}

/**
 * The short noun a line's kind is described by in a group heading or a screen-reader label. Delegates
 * to the SSOT's {@link itemKindMeta} — the labels are the contract's, not a second vocabulary.
 */
export function itemKindLabel(item: BasketItem): string {
	return itemKindMeta(item.itemType).label;
}
// #endregion

// #region Owner scope
/** Which kind of principal an owner scope key names (`personal` has no prefix). */
export function ownerKindOf(owner: string): "personal" | "team" | "business" | "enterprise" {
	const prefix = owner.slice(0, owner.indexOf(":"));
	return prefix === "team" || prefix === "business" || prefix === "enterprise"
		? prefix
		: "personal";
}

/**
 * The `owner` param a context defaults to: `personal` for an individual, `{entity}:{id}` for a
 * team/business/enterprise context.
 *
 * Mirrors the fat service's `defaultOwnerParam` and the wallet's `defaultWalletParam`, so switching
 * context moves the wallet and the basket together. Restated app-side rather than imported because
 * `packages/backend` is a server member an island may not reach into (root CLAUDE.md §2).
 */
export function defaultOwnerParam(context: UserContext): string {
	switch (context.contextType) {
		case "team":
			return context.contextId ? `team:${context.contextId}` : "personal";
		case "business":
			return context.contextId ? `business:${context.contextId}` : "personal";
		case "enterprise":
			return context.contextId ? `enterprise:${context.contextId}` : "personal";
		default:
			return "personal";
	}
}

// #endregion

// #region URL ⇄ context
/** The `?project_id=` / `?service_id=` narrowing a URL carries, in either spelling. */
export function preselectFrom(sp: URLSearchParams): CheckoutPreselect {
	return {
		projectId: sp.get("project_id") ?? sp.get("projectId"),
		serviceId: sp.get("service_id") ?? sp.get("serviceId"),
	};
}

/**
 * Build the client read context from a request URL and the acting context. Used by the routes and slot
 * resolvers to echo the resolved scope into their islands, so the island's first refetch asks for
 * exactly what SSR painted.
 */
export function contextFrom(sp: URLSearchParams, context: UserContext): CheckoutContext {
	const preselect = preselectFrom(sp);
	return {
		basketId: sp.get("basketId") ?? sp.get("basket"),
		owner: sp.get("owner") ?? defaultOwnerParam(context),
		display: sp.get("display"),
		projectId: preselect.projectId,
		serviceId: preselect.serviceId,
	};
}

/**
 * Serialise a read context into the `/api/basket|checkout|cards` query string.
 *
 * Scope only — which basket, whose money, which display currency, which deep link — plus the route
 * and the contribution the read is for. Nothing here changes what the server answers about the
 * account: that is read live, as the signed-in caller.
 */
export function buildCheckoutQuery(ctx: CheckoutContext): string {
	const qs = new URLSearchParams();
	if (ctx.basketId) qs.set("basket", ctx.basketId);
	// Always sent, `personal` included: an absent owner means the acting context's default, which is
	// a team or business whenever the shell is acting as one.
	if (ctx.owner) qs.set("owner", ctx.owner);
	if (ctx.display) qs.set("display", ctx.display);
	if (ctx.projectId) qs.set("project_id", ctx.projectId);
	if (ctx.serviceId) qs.set("service_id", ctx.serviceId);
	if (ctx.provider) qs.set("provider", ctx.provider);
	if (ctx.contribute !== undefined) qs.set("contribute", ctx.contribute ? "1" : "0");
	return qs.toString();
}

/**
 * Fold the read context into a MUTATION body, so the basket a write answers with is the one the caller
 * is looking at — without it a write on a team basket would hand back the personal one, and a write on
 * a named list would hand back the line's own basket. The fat service's `basketQueryFromBody` reads
 * exactly these keys, and the write echoes `basketId` (`echoBasketId`).
 *
 * A payload's own `basketId` (an add's target, a promo's basket) wins over the context's.
 */
export function withContext<T extends Record<string, unknown>>(
	payload: T,
	ctx: CheckoutContext,
): T & Record<string, unknown> {
	return {
		...(ctx.basketId ? { basketId: ctx.basketId } : {}),
		...payload,
		...(ctx.owner ? { owner: ctx.owner } : {}),
		...(ctx.display ? { display: ctx.display } : {}),
		...(ctx.provider ? { provider: ctx.provider } : {}),
		...(ctx.contribute !== undefined ? { contribute: ctx.contribute } : {}),
	};
}
// #endregion
