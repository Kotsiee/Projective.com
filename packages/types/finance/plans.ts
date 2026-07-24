import { z } from "zod";
import { basisPoints, currency, minorUnitsNonNeg, timestamp, uuid } from "./common.ts";

/**
 * finance subscriptions — the PAID ladder: the plan catalogue, per-subject subscriptions, their audit
 * trail, the earned commission taper and the negotiated-rate flex.
 *
 * Mirrors `finance.plans` / `subscriptions` (extended) / `subscription_events` /
 * `standing_commission_tiers` / `negotiated_rates` (migration
 * `20260724112000_billing_plans_entitlements.sql`). The migration, this SSOT, and
 * `documentation/database/finance/*` land together (root CLAUDE.md §1).
 *
 * **The three axes** (finance-model.md §1.1):
 * 1. EXECUTION capacity — never monetised; governed by the $W_i$ concurrency caps.
 * 2. DISTRIBUTION — proposals; a tiered *allowance* (see `entitlements.ts`), never sold à la carte.
 * 3. MARKETPLACE FOOTPRINT — live public projects, listings, entities owned, seats, promotion.
 *
 * **The second separation:** a plan accelerates capacity; it can never buy reputation. Nothing here
 * writes to `@projective/types/org` Standing.
 */

// #region Vocabulary
/** `finance.plan_audience` — which catalogue a subject shops from. */
export const PlanAudience = z.enum(["individual", "team", "business", "organisation"]);
export type PlanAudience = z.infer<typeof PlanAudience>;

/** `finance.plan_tier`. */
export const PlanTier = z.enum(["free", "pro", "enterprise"]);
export type PlanTier = z.infer<typeof PlanTier>;

/** `finance.billing_interval`. */
export const BillingInterval = z.enum(["monthly", "annual", "custom"]);
export type BillingInterval = z.infer<typeof BillingInterval>;

/** `finance.subscription_state`. */
export const SubscriptionState = z.enum([
	"trialing",
	"active",
	"past_due",
	"paused",
	"cancelled",
	"expired",
]);
export type SubscriptionState = z.infer<typeof SubscriptionState>;

/** The seeded plan codes. A new plan is a migration + a change here in the same commit. */
export const PlanCode = z.enum([
	"individual_free",
	"individual_pro",
	"team_free",
	"team_pro",
	"business_free",
	"business_pro",
	"organisation_free",
	"organisation",
]);
export type PlanCode = z.infer<typeof PlanCode>;

/** Which entity a subscription is attached to. Mirrors the finance owner-scope vocabulary. */
export const SubscriptionSubject = z.enum([
	"user",
	"freelancer",
	"team",
	"business",
	"organisation",
]);
export type SubscriptionSubject = z.infer<typeof SubscriptionSubject>;
// #endregion

// #region Plans
/**
 * A row of `finance.plans`.
 *
 * `priceCents` is `null` for a custom/negotiated plan (Organisation) **and** for `business_pro`,
 * whose monthly rate is still TBD (flagged, root CLAUDE.md §8) — the entitlements are seeded, the
 * price is not.
 */
export const PlanSchema = z.object({
	id: uuid,
	code: z.string().min(1).max(60),
	label: z.string().min(1).max(80),
	audience: PlanAudience,
	tier: PlanTier,
	priceCents: minorUnitsNonNeg.nullable(),
	currency,
	billingInterval: BillingInterval,
	isCustomPriced: z.boolean(),
	/** Seat-based pricing (Organisation) keys off `org.employee_scale`. */
	perSeatCents: minorUnitsNonNeg.nullable(),
	/** The free plan every subject of this audience implicitly holds. */
	isDefault: z.boolean(),
	isPublic: z.boolean(),
	sortOrder: z.number().int(),
	provider: z.string().max(40),
	/** Stripe Price id — `XXXX-XXXX` in docs. */
	providerPriceRef: z.string().max(200).nullable(),
	pricingNote: z.string().nullable(),
	createdAt: timestamp,
});
export type Plan = z.infer<typeof PlanSchema>;
// #endregion

// #region Subscriptions
/**
 * A row of `finance.subscriptions`.
 *
 * The 0009 skeleton (`profileId`, `plan`, `status`) is RETAINED and mirrored from the authoritative
 * columns by a BEFORE trigger — never drop it, never write it directly.
 */
export const SubscriptionSchema = z.object({
	id: uuid,
	subjectType: SubscriptionSubject.nullable(),
	subjectId: uuid.nullable(),
	planId: uuid.nullable(),
	state: SubscriptionState,
	billingInterval: BillingInterval,
	currentPeriodStart: timestamp.nullable(),
	currentPeriodEnd: timestamp.nullable(),
	cancelAtPeriodEnd: z.boolean(),
	trialEndsAt: timestamp.nullable(),
	seats: z.number().int().positive().nullable(),
	priceCents: minorUnitsNonNeg.nullable(),
	currency: currency.nullable(),
	provider: z.string().max(40),
	providerRef: z.string().max(200).nullable(),
	startedAt: timestamp,
	endsAt: timestamp.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
	/** Legacy mirror (migration 0009) — derived, read-only. */
	profileId: uuid,
	/** Legacy mirror of the plan code — derived, read-only. */
	plan: z.string(),
	/** Legacy mirror of `state` — derived, read-only. */
	status: z.string(),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

/** A row of `finance.subscription_events` — the billing audit trail. */
export const SubscriptionEventSchema = z.object({
	id: uuid,
	subscriptionId: uuid.nullable(),
	subjectType: SubscriptionSubject,
	subjectId: uuid,
	eventType: z.enum([
		"started",
		"upgraded",
		"downgraded",
		"renewed",
		"payment_failed",
		"paused",
		"resumed",
		"cancelled",
		"expired",
	]),
	fromPlanId: uuid.nullable(),
	toPlanId: uuid.nullable(),
	amountCents: minorUnitsNonNeg.nullable(),
	currency: currency.nullable(),
	providerRef: z.string().max(200).nullable(),
	reason: z.string().nullable(),
	createdAt: timestamp,
});
export type SubscriptionEvent = z.infer<typeof SubscriptionEventSchema>;
// #endregion

// #region Rates
/**
 * A row of `finance.standing_commission_tiers` — the EARNED marketplace-commission taper (8% → 6.5%).
 * The retention mechanic: the platform's best sellers pay the least, and they cannot buy their way
 * there. `platformFeeBp` is `null` at every rung — the 5% project service fee does NOT taper with
 * Standing.
 */
export const StandingCommissionTierSchema = z.object({
	level: z.number().int().min(1).max(5),
	marketplaceCommissionBp: basisPoints,
	platformFeeBp: basisPoints.nullable(),
	note: z.string().nullable(),
});
export type StandingCommissionTier = z.infer<typeof StandingCommissionTierSchema>;

/**
 * A row of `finance.negotiated_rates` — the ONE sanctioned flex of the 5% service fee (owner
 * decision, 2026-07-24: it may flex for Organisation volume commitments). Every flex is an explicit,
 * admin-approved, time-boxed contract row, never an implicit consequence of holding a plan.
 */
export const NegotiatedRateSchema = z.object({
	id: uuid,
	subjectType: z.enum(["business", "organisation"]),
	subjectId: uuid,
	platformFeeBp: basisPoints,
	marketplaceCommissionBp: basisPoints.nullable(),
	/** The volume commitment the discount is priced against. */
	minimumVolumeCents: minorUnitsNonNeg.nullable(),
	currency: currency.nullable(),
	contractRef: z.string().max(200).nullable(),
	approvedBy: uuid.nullable(),
	startsAt: timestamp,
	endsAt: timestamp.nullable(),
	status: z.enum(["draft", "active", "expired", "revoked"]),
	createdAt: timestamp,
});
export type NegotiatedRate = z.infer<typeof NegotiatedRateSchema>;
// #endregion
