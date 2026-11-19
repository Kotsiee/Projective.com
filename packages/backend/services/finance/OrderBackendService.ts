import {
	ORDER_HISTORY_PAGE_SIZE,
	type OrderHistoryPage,
	type OrderPage,
} from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import type { BasketQuery } from "./basket-query.ts";
import { listOwners, resolveOwner } from "./commerce-owner.ts";
import { icsFor, readOrderHistory, readOrderPage } from "./live-orders.ts";
import { decodeOrderCursor } from "./order-history.ts";

/**
 * OrderBackendService — the FAT half of `/checkout/confirmation`: the order a completed checkout
 * produced, and the calendar file a booked line on it downloads as — read LIVE from `finance.orders` /
 * `finance.order_lines` as the signed-in caller.
 *
 * **It reads; it never charges.** An order is written exactly once, at the moment a charge is made, so
 * confirmation is a GET over that record and never a re-POST.
 *
 * **A receipt reprints; it does not recompute.** Every figure is the order's own, in the currency it
 * was charged in (see `live-orders`).
 */

/** The confirmation read's query: the order to show, within the acting account's scope. */
export interface OrderQuery extends BasketQuery {
	orderId?: string | null;
}

/** The history read's query: the acting account, and at most one page boundary (`?after=` / `?before=`). */
export interface OrderHistoryQuery extends BasketQuery {
	/** List the orders placed before this boundary (the next page back). */
	after?: string | null;
	/** List the orders placed after this boundary (the page before). Ignored when `after` is set. */
	before?: string | null;
}

const SIGNED_OUT = fail(401, { message: "Sign in to see your orders." });
const UNREACHABLE = fail(503, { message: "We couldn't reach your orders just now. Try again in a moment." });

export class OrderBackendService {
	/**
	 * The confirmation hub's whole read: the resolved order and the account's other recent ones.
	 *
	 * `orderId` names one; without it the account's most recent is returned, which is what makes the
	 * page reachable from a link that has lost its query string. Returns a `404` when the account has
	 * no orders at all, so the route can send the buyer back to the basket rather than render a
	 * confirmation page that has to invent something to confirm.
	 */
	static async get(query: OrderQuery, actor: ReadActor): Promise<ServiceResult<{ page: OrderPage }>> {
		try {
			const owner = await resolveOwner(query, actor);
			if (!owner) return SIGNED_OUT;
			const page = await readOrderPage(owner, query.orderId, actor);
			if (!page) return fail(404, { message: "We couldn't find an order for this account yet." });
			return ok({ page });
		} catch (error) {
			console.error("[orders]", error instanceof Error ? error.message : error);
			return UNREACHABLE;
		}
	}

	/**
	 * One page of the acting account's order history, newest first (MARKETPLACE CK3), following the
	 * basket's owner switch (`?owner=`): a person's own orders, or a team's or business's to a member who
	 * may see its finances. A boundary token this service did not mint reads as the newest page, so a
	 * mangled link lands somewhere true rather than on an error. An account with no orders is an empty
	 * page, not a 404: the history is a place, and it is empty.
	 */
	static async history(
		query: OrderHistoryQuery,
		actor: ReadActor,
	): Promise<ServiceResult<{ page: OrderHistoryPage }>> {
		try {
			const owner = await resolveOwner(query, actor);
			if (!owner) return SIGNED_OUT;
			const after = decodeOrderCursor(query.after);
			const before = after ? null : decodeOrderCursor(query.before);
			const [page, owners] = await Promise.all([
				readOrderHistory(owner, {
					cursor: after ?? before,
					direction: before ? "newer" : "older",
					limit: ORDER_HISTORY_PAGE_SIZE,
				}, actor),
				listOwners(query, actor).catch(() => [owner]),
			]);
			if (!page) return SIGNED_OUT;
			const switchable = owners.some((o) => o.key === owner.key) ? owners : [owner, ...owners];
			return ok({
				page: {
					...page,
					owners: switchable.slice(0, 50).map((o) => ({ key: o.key, name: o.name.slice(0, 120) })),
				},
			});
		} catch (error) {
			console.error("[orders]", error instanceof Error ? error.message : error);
			return UNREACHABLE;
		}
	}

	/** The `.ics` document for one booked line, and the filename it downloads as. */
	static async ics(
		orderId: string,
		lineId: string,
		query: OrderQuery,
		actor: ReadActor,
	): Promise<ServiceResult<{ filename: string; body: string }>> {
		try {
			const owner = await resolveOwner(query, actor);
			if (!owner) return SIGNED_OUT;
			const file = await icsFor(owner, orderId, lineId, actor);
			if (!file) return fail(404, { message: "That booking doesn't have a calendar entry." });
			return ok(file);
		} catch (error) {
			console.error("[orders]", error instanceof Error ? error.message : error);
			return UNREACHABLE;
		}
	}
}
