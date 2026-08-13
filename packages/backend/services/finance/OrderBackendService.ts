import type { OrderPage } from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isFinanceBackendLive } from "../../core/supabase.ts";
import * as fx from "./basket-fixtures.ts";
import * as buyer from "./buyer-fixtures.ts";
import { icsFor, type OrderFixtureQuery, orderFor } from "./order-fixtures.ts";

/**
 * OrderBackendService — the FAT half of `/checkout/confirmation`: the order a completed checkout
 * produced, and the calendar file a booked line on it downloads as.
 *
 * **It reads; it never charges.** The order is written exactly once, by
 * `CheckoutBackendService.create()`, at the moment the charge is attempted. Confirmation is therefore
 * a GET over that record and never a re-POST — the idempotency ledger is a process-local `Map` with
 * no TTL, so a confirmation page that re-submitted the payment would work in development and
 * double-charge behind more than one instance (CLAUDE.md Decision #68, flagged item).
 *
 * **A receipt reprints; it does not recompute.** Every figure returned here is the `MoneyView` the
 * charge produced, in the currency it was charged in, and the conversion behind it is the snapshot
 * captured at the time. Re-projecting a settled amount into today's display currency would show a
 * buyer a figure they were never charged.
 *
 * Gated by {@link isFinanceBackendLive} (`FINANCE_BACKEND_LIVE`, default off): no `finance.orders`
 * table exists yet, so the read answers from the deterministic order corpus, exactly like every
 * sibling projection in this vertical. The LIVE branch is a documented placeholder falling back to
 * the same fixtures with zero shape churn — the projection is already the Zod SSOT.
 */
export class OrderBackendService {
	/**
	 * The confirmation hub's whole read: the resolved order and the account's other recent ones.
	 *
	 * `orderId` names one; without it the account's most recent is returned, which is what makes the
	 * page reachable from a link that has lost its query string. An order belonging to a different
	 * account is never returned even when its id is named — an id in a URL is a guess anyone can make,
	 * and a receipt carries an address, a company registration and a card fragment.
	 *
	 * Returns a `404` when the account has no orders at all, so the route can send the buyer back to
	 * the basket rather than render a confirmation page that has to invent something to confirm.
	 */
	static get(query: OrderFixtureQuery): ServiceResult<{ page: OrderPage }> {
		if (isFinanceBackendLive()) {
			// LIVE: read `finance.orders` + `finance.order_lines` under the caller's JWT (RLS scopes it)
			// and reprint each row's committed FX snapshot — not yet implemented; fall back to fixtures.
		}
		const owner = fx.resolveOwner(query);
		const page = orderFor(owner, buyer.buyerDetailsFor(owner, query), query);
		if (!page) {
			return fail(404, {
				message: "We couldn't find an order for this account yet.",
			});
		}
		return ok({ page });
	}

	/**
	 * The `.ics` document for one booked line, and the filename it downloads as.
	 *
	 * Delegates to the SSOT's `buildIcsCalendar` through the fixtures — one iCalendar writer, so the
	 * file a buyer downloads and the Google/Outlook links beside it describe the same event. The body
	 * is deterministic (the builder is pure and its `DTSTAMP` is fixed), so two downloads of one
	 * booking are byte-identical rather than two events a calendar might not de-duplicate.
	 */
	static ics(
		orderId: string,
		lineId: string,
		query: OrderFixtureQuery,
	): ServiceResult<{ filename: string; body: string }> {
		if (isFinanceBackendLive()) {
			// LIVE: same read as `get`, same builder — the file is a projection, not a second source.
		}
		const owner = fx.resolveOwner(query);
		const file = icsFor(owner, buyer.buyerDetailsFor(owner, query), orderId, lineId, query);
		if (!file) {
			return fail(404, {
				message: "That booking doesn't have a calendar entry.",
			});
		}
		return ok(file);
	}
}

/** Re-exported so a thin route types its query without reaching past the service it calls. */
export type { OrderFixtureQuery };
