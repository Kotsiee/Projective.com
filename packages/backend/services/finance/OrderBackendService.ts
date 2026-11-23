import {
	ORDER_HISTORY_PAGE_SIZE,
	type OrderHistoryPage,
	type OrderPage,
} from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import { getUserClient } from "../../core/supabase.ts";
import { refuseUnlessMoneyLive } from "./money-gate.ts";
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

	/**
	 * Cancel a digital product purchase while its sale is still clearing (FBP DB21): the entitlement's
	 * slug names the line, read under the caller's JWT, then `finance.cancel_order_line` refunds the
	 * buyer and takes the seller's still-clearing credit back. A money write, so the switch comes first.
	 */
	static cancelLine(
		entitlement: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ status: string; refundedMinor: number; currency: string }>> {
		return refundCall("cancel", actor, async (db) => {
			const { data: row, error: readError } = await db.schema("catalogue").from("entitlements")
				.select("order_line_id").eq("slug", entitlement).maybeSingle();
			if (readError) throw new Error(readError.message);
			if (!row) return fail(404, { message: "That purchase doesn't exist." });
			const { data, error } = await db.schema("finance").rpc("cancel_order_line", {
				p_line_id: (row as { order_line_id: string }).order_line_id,
			});
			if (error) return refusal(error);
			const out = data as { status: string; refunded_minor: number; currency: string };
			return ok({ status: out.status, refundedMinor: Number(out.refunded_minor), currency: out.currency });
		});
	}

	/**
	 * Give a session forfeit back in full (FBP DB21; ruling M8, voluntary): `finance.refund_session_forfeit`
	 * takes it from the provider's money still clearing first, then their wallet. A money write.
	 */
	static refundForfeit(
		escrowId: string,
		actor: ReadActor,
	): Promise<ServiceResult<{ refundedMinor: number; currency: string }>> {
		return refundCall("forfeit", actor, async (db) => {
			const { data, error } = await db.schema("finance").rpc("refund_session_forfeit", {
				p_escrow_id: escrowId,
			});
			if (error) return refusal(error);
			const out = data as { refunded_minor: number; currency: string };
			return ok({ refundedMinor: Number(out.refunded_minor), currency: out.currency });
		});
	}
}

// #region Refunds
/** A refund door's refusal (SQLSTATE + message) onto a ServiceResult. */
function refusal<T>(error: { code?: string; message?: string }): ServiceResult<T> {
	const message = error.message ?? "That couldn't be done just now.";
	switch (error.code) {
		case "42501":
			return fail(403, { message });
		case "22023":
			return fail(422, { message });
		case "P0002":
			return fail(404, { message });
		case "PO409":
		case "PW402":
			return fail(409, { message });
		default:
			return fail(502, { message: "That couldn't be done just now. Please try again." });
	}
}

/** The money switch, then the call; an unexpected failure is a 503, never a throw into the route. */
async function refundCall<T>(
	label: string,
	actor: ReadActor,
	run: (db: ReturnType<typeof getUserClient>) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
	const blocked = refuseUnlessMoneyLive<T>(actor);
	if (blocked) return blocked;
	try {
		return await run(getUserClient(actor.accessToken!));
	} catch (error) {
		console.error(`[orders:${label}]`, error instanceof Error ? error.message : error);
		return UNREACHABLE as ServiceResult<T>;
	}
}
// #endregion
