import {
	BillingInterval,
	type CurrentPlan,
	type PlanOffer,
	PlanTier,
	SubscriptionState,
} from "@projective/types/finance";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getUserClient, isFinanceBackendLive } from "../../core/supabase.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";

/**
 * PlanBackendService — the person's own plan for Settings → Billing's subscription placeholder: the
 * plan held (or the individual audience's free default when no subscription row exists), its state
 * and renewal date, and the audience's public plans for the comparison.
 *
 * Read-only by design: there is no plan checkout yet, so nothing here changes a subscription. Both
 * reads run on the caller's token under `finance.plans` "Read public plans" and
 * `finance.subscriptions` "View own subscriptions".
 */

// #region Rows
interface PlanRow {
	id: string;
	code: string;
	label: string;
	tier: string;
	price_cents: number | null;
	currency: string;
	billing_interval: string;
	is_custom_priced: boolean;
	is_default: boolean;
	pricing_note: string | null;
}

interface SubscriptionRow {
	plan_id: string | null;
	state: string;
	current_period_end: string | null;
	cancel_at_period_end: boolean;
}

const PLAN_COLUMNS =
	"id, code, label, tier, price_cents, currency, billing_interval, is_custom_priced, is_default, pricing_note";

/** A subscription in one of these states is the plan the person holds right now. */
const HELD_STATES = ["trialing", "active", "past_due", "paused"] as const;

/** One plan row → the comparison's shape, or `null` when a column is outside the SSOT. */
export function toPlanOffer(row: PlanRow): PlanOffer | null {
	const tier = PlanTier.safeParse(row.tier);
	const interval = BillingInterval.safeParse(row.billing_interval);
	if (!tier.success || !interval.success) return null;
	return {
		code: row.code,
		label: row.label,
		tier: tier.data,
		priceCents: row.price_cents,
		currency: row.currency.trim().toUpperCase(),
		billingInterval: interval.data,
		isCustomPriced: row.is_custom_priced,
		pricingNote: row.pricing_note,
	};
}
// #endregion

export class PlanBackendService {
	/** The caller's plan, its state and the individual plans it compares with. */
	static async current(actor: ReadActor): Promise<ServiceResult<{ plan: CurrentPlan | null }>> {
		if (!actor.userId) return fail(401, { message: "Sign in to see your plan." });
		if (!isFinanceBackendLive() || !canReadLive(actor)) return ok({ plan: null });
		try {
			const db = getUserClient(actor.accessToken).schema("finance");
			const [plans, subs] = await Promise.all([
				db.from("plans")
					.select(PLAN_COLUMNS)
					.eq("audience", "individual")
					.eq("is_public", true)
					.order("sort_order"),
				db.from("subscriptions")
					.select("plan_id, state, current_period_end, cancel_at_period_end")
					.in("subject_type", ["user", "freelancer"])
					.eq("subject_id", actor.userId)
					.in("state", [...HELD_STATES])
					.order("started_at", { ascending: false })
					.limit(1),
			]);
			if (plans.error) throw new Error(plans.error.message);
			if (subs.error) throw new Error(subs.error.message);

			const rows = (plans.data ?? []) as PlanRow[];
			const held = ((subs.data ?? []) as SubscriptionRow[])[0] ?? null;
			const heldRow = held ? rows.find((row) => row.id === held.plan_id) : undefined;
			const currentRow = heldRow ?? rows.find((row) => row.is_default) ?? rows[0];
			const current = currentRow ? toPlanOffer(currentRow) : null;
			if (!current) return ok({ plan: null });

			const state = held ? SubscriptionState.safeParse(held.state) : null;
			return ok({
				plan: {
					current,
					state: state?.success ? state.data : null,
					renewsAt: heldRow ? held?.current_period_end ?? null : null,
					cancelAtPeriodEnd: heldRow ? held?.cancel_at_period_end ?? false : false,
					offers: rows.map(toPlanOffer).filter((offer): offer is PlanOffer => offer !== null),
				},
			});
		} catch (error) {
			return fail(503, {
				message: "Your plan couldn't be read just now.",
				details: { reason: error instanceof Error ? error.message : String(error) },
			});
		}
	}
}
