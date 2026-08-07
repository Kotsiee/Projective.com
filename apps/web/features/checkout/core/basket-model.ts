import type { UserContext } from "@projective/types/auth";
import { itemKindMeta } from "@projective/types/finance";
import type {
	BasketItem,
	BasketOwnerScope,
	BasketSim,
	CheckoutContext,
	CheckoutPreselect,
	CheckoutView,
	PaymentOfferPreset,
	SavedCardState,
	WalletCoverage,
} from "../types/checkout-types.ts";

/**
 * basket-model — the pure, presentation-agnostic helpers the `/basket` + `/checkout` islands, routes and
 * SSR resolvers share: the URL ⇄ {@link CheckoutContext} mapping, the simulation-param serialiser, the
 * surface vocabulary, and — the one that matters most — the SINGLE resolver for where a basket line
 * points.
 *
 * No state, no DOM, no money arithmetic. Safe to import from a server resolver and from an island.
 */

// #region Surface vocabulary
/** The route a pathname addresses (`/basket` → basket, `/checkout` → checkout). */
export function checkoutViewOf(pathname: string): CheckoutView {
	return pathname === "/checkout" || pathname.startsWith("/checkout/") ? "checkout" : "basket";
}

/** Whether a URL belongs to this feature at all — the guard every slot resolver opens with. */
export function isCheckoutPath(pathname: string): boolean {
	return pathname === "/basket" || pathname.startsWith("/basket/") ||
		pathname === "/checkout" || pathname.startsWith("/checkout/");
}

/** The `/basket` href for a named basket, preserving the acting owner scope. */
export function basketHref(basketId?: string | null, owner?: string | null): string {
	return withParams("/basket", { basket: basketId ?? null, owner: ownerParamOf(owner) });
}

/**
 * The `/checkout` href for a basket, optionally narrowed to one project or service.
 *
 * The narrowing params keep the SSOT's documented snake_case spelling (`project_id` / `service_id`,
 * per `CheckoutPreselect`) because a checkout link is written by hand as often as it is generated.
 */
export function checkoutHref(
	basketId?: string | null,
	owner?: string | null,
	preselect?: Partial<CheckoutPreselect>,
): string {
	return withParams("/checkout", {
		basket: basketId ?? null,
		owner: ownerParamOf(owner),
		project_id: preselect?.projectId ?? null,
		service_id: preselect?.serviceId ?? null,
	});
}

/** Append the non-empty params to a path, or return it unchanged. */
function withParams(path: string, params: Record<string, string | null>): string {
	const qs = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
	const q = qs.toString();
	return q ? `${path}?${q}` : path;
}

/** Drop a `personal` owner from a link — it is the default, and an explicit default is noise. */
function ownerParamOf(owner?: string | null): string | null {
	return owner && owner !== "personal" ? owner : null;
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
 * namespace `/projects/[projectId]/[channelId]`.
 *
 * **Flagged:** the second segment is a CHANNEL id in that namespace, and a basket line carries a STAGE
 * id. They coincide in the current fixtures (a stage channel is addressed by its stage segment), but a
 * live path that diverges must map stage → channel here rather than at each call site. `null` when the
 * line is not stage-routed or its project is unknown.
 */
export function stageHref(item: BasketItem): string | null {
	if (!item.stageId) return null;
	const projectId = typeof item.metadata.projectId === "string" ? item.metadata.projectId : null;
	if (!projectId) return null;
	return `/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(item.stageId)}`;
}

/** Strip a leading `@` so a handle is never double-prefixed in a URL. */
function stripAt(handle: string): string {
	return handle.startsWith("@") ? handle.slice(1) : handle;
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
/**
 * The `owner` param a context defaults to: `personal` for an individual, `{entity}:{id}` for a
 * team/business/organisation context.
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
		case "organisation":
			return context.contextId ? `organisation:${context.contextId}` : "personal";
		default:
			return "personal";
	}
}

/** The scope kind an `owner` param names (`team:northwind` → `team`). */
export function ownerScopeOf(owner: string | null | undefined): BasketOwnerScope {
	if (!owner) return "personal";
	const scope = owner.split(":")[0];
	return scope === "team" || scope === "business" || scope === "organisation" ? scope : "personal";
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
 * The four original simulation knobs keep their plain names (`persona`, `workspaceRole`, `kyb`,
 * `acting`) because those are already the published route contract; the four added for this surface
 * carry the `sim*` prefix of the newer `WorkspaceSim` precedent. The mixed vocabulary is flagged in
 * `basket-query.ts` rather than silently unified.
 */
export function buildCheckoutQuery(ctx: CheckoutContext): string {
	const qs = new URLSearchParams();
	if (ctx.basketId) qs.set("basket", ctx.basketId);
	if (ctx.owner && ctx.owner !== "personal") qs.set("owner", ctx.owner);
	if (ctx.display) qs.set("display", ctx.display);
	if (ctx.projectId) qs.set("project_id", ctx.projectId);
	if (ctx.serviceId) qs.set("service_id", ctx.serviceId);
	const s = ctx.sim;
	if (s?.persona) qs.set("persona", s.persona);
	if (s?.workspaceRole) qs.set("workspaceRole", s.workspaceRole);
	if (s?.kyb) qs.set("kyb", s.kyb);
	if (s?.actingContext !== undefined) qs.set("acting", s.actingContext ? "1" : "0");
	if (s?.ownerScope) qs.set("simOwnerScope", s.ownerScope);
	if (s?.providers) qs.set("simProviders", s.providers);
	if (s?.walletCover) qs.set("simWalletCover", s.walletCover);
	if (s?.cards) qs.set("simCards", s.cards);
	if (s?.googlePay !== undefined) qs.set("googlePay", s.googlePay ? "1" : "0");
	if (s?.applePay !== undefined) qs.set("applePay", s.applePay ? "1" : "0");
	if (s?.paypalEnabled !== undefined) qs.set("paypal", s.paypalEnabled ? "1" : "0");
	return qs.toString();
}

/**
 * Fold the read context into a MUTATION body, so the basket a write answers with reflects the same
 * scope and simulation the read used.
 *
 * Without this a simulated business basket would accept a write and hand back the personal one — the
 * fat service's `basketQueryFromBody` reads exactly these keys for that reason.
 */
export function withContext<T extends Record<string, unknown>>(
	payload: T,
	ctx: CheckoutContext,
): T & Record<string, unknown> {
	const s = ctx.sim;
	return {
		...payload,
		...(ctx.owner && ctx.owner !== "personal" ? { owner: ctx.owner } : {}),
		...(ctx.display ? { display: ctx.display } : {}),
		...(s?.persona ? { persona: s.persona } : {}),
		...(s?.workspaceRole ? { workspaceRole: s.workspaceRole } : {}),
		...(s?.kyb ? { kyb: s.kyb } : {}),
		...(s?.actingContext !== undefined ? { acting: s.actingContext } : {}),
		...(s?.ownerScope ? { simOwnerScope: s.ownerScope } : {}),
		...(s?.providers ? { simProviders: s.providers } : {}),
		...(s?.walletCover ? { simWalletCover: s.walletCover } : {}),
		...(s?.cards ? { simCards: s.cards } : {}),
	};
}

/**
 * Parse the simulation knobs back OUT of a query string.
 *
 * The server has its own validating parser (`parseBasketSim`); this one exists so a client surface can
 * read a shared/bookmarked simulated URL and seed its controls from it instead of silently rendering a
 * different world from the one the link described.
 */
export function simFromParams(sp: URLSearchParams): BasketSim | undefined {
	const sim: BasketSim = {};
	const owner = oneOf<BasketOwnerScope>(sp.get("simOwnerScope"), [
		"personal",
		"team",
		"business",
		"organisation",
	]);
	if (owner) sim.ownerScope = owner;
	const providers = oneOf<PaymentOfferPreset>(sp.get("simProviders"), [
		"all",
		"no_wallet",
		"card_only",
		"invoice",
	]);
	if (providers) sim.providers = providers;
	const cover = oneOf<WalletCoverage>(sp.get("simWalletCover"), ["covers", "shortfall"]);
	if (cover) sim.walletCover = cover;
	const cards = oneOf<SavedCardState>(sp.get("simCards"), ["seeded", "none", "expired"]);
	if (cards) sim.cards = cards;
	return Object.keys(sim).length > 0 ? sim : undefined;
}

/** Narrow a raw param to a member of `allowed`, else `undefined`. */
function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | undefined {
	return raw !== null && (allowed as readonly string[]).includes(raw) ? raw as T : undefined;
}
// #endregion
