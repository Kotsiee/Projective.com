import { z } from "zod";
import { timestamp, uuid } from "./common.ts";
import { PlanAudience, SubscriptionSubject } from "./plans.ts";

/**
 * finance entitlements — what a plan actually grants, how the earned ladder scales it, and how
 * metered distribution (proposals) is accounted.
 *
 * Mirrors `finance.plan_entitlements` / `entitlement_grants` / `allowance_periods` /
 * `allowance_ledger` and the resolver functions `fn_effective_limit` / `fn_has_entitlement` /
 * `fn_current_allowance` / `fn_consume_allowance` / `fn_footprint_usage`
 * (migrations `20260724112000` + `20260724113000`).
 *
 * **The design constraint** (product owner, 2026-07-24): *"a user should never feel suffocated by
 * their tier — the features they have should feel plentiful, and upgrading should just make sense."*
 * Every free-tier magnitude is deliberately generous, and every ceiling exists for anti-spam or
 * shared-resource fairness, never as a toll.
 */

// #region Vocabulary
/**
 * `finance.entitlement_key` — the closed limit vocabulary. Adding a lever is a migration + a change
 * here in the same commit: deliberate friction that keeps the SSOT honest.
 */
export const EntitlementKey = z.enum([
	// Footprint (buyer side)
	"active_public_projects",
	"private_drafts",
	// Footprint (seller side)
	"published_listings",
	// Footprint (stored bytes). Denominated in MEBIBYTES, never bytes: `plan_entitlements.limit_value`
	// and every resolver that reads it return `integer`, and 25 GB expressed in BYTES is
	// 26,843,545,600 — an int4 overflow. MiB keeps the whole ladder (25 GiB … 500 GiB) in range.
	"storage_megabytes",
	// Distribution
	"weekly_proposals",
	"proposal_buffer_per_10h",
	// Ownership umbrella — how many entities a PERSON may spin up
	"teams_owned",
	"businesses_owned",
	"teams_joined",
	"businesses_joined",
	// Entity muscle — what an entity's OWN plan powers
	"team_seats",
	"team_public_projects",
	"business_public_projects",
	"business_managers",
	"organisation_seats",
	"organisation_businesses",
	"departments",
	// Capability flags
	"promoted_placement",
	"advanced_analytics",
	"discovery_boost",
	"instant_payouts_included",
	"pooled_wallet_full",
	"advanced_vault_splits",
	"intervaled_invoicing",
	"sso_enabled",
	"api_access",
	"audit_log_retention_days",
	"dedicated_support",
	"negotiated_platform_fee",
]);
export type EntitlementKey = z.infer<typeof EntitlementKey>;

/** `finance.entitlement_kind` — a limit carries a number; a flag carries a capability. */
export const EntitlementKind = z.enum(["limit", "flag"]);
export type EntitlementKind = z.infer<typeof EntitlementKind>;

/**
 * `finance.entitlement_scaling` — how the EARNED ladder modifies a plan's value.
 *
 * - `none` — the plan value is final.
 * - `standing_base` — `effective = standingLevel.listingBase × (multiplierBp / 10000)`. Free is 1.0x
 *   the rung's base, Pro is 2.0x — so an ambitious free user *earns* their way up and Pro doubles
 *   whatever they earned, rather than replacing it.
 * - `standing_bonus` — `effective = limitValue + standingLevel.proposalBonus`. Reliability buys
 *   volume the same way money does; that symmetry is the anti-Upwork headline.
 */
export const EntitlementScaling = z.enum(["none", "standing_base", "standing_bonus"]);
export type EntitlementScaling = z.infer<typeof EntitlementScaling>;
// #endregion

// #region Rows
/** A row of `finance.plan_entitlements`. */
export const PlanEntitlementSchema = z.object({
	id: uuid,
	planId: uuid,
	entitlementKey: EntitlementKey,
	kind: EntitlementKind,
	limitValue: z.number().int().min(0).nullable(),
	isUnlimited: z.boolean(),
	flagValue: z.boolean(),
	scaling: EntitlementScaling,
	multiplierBp: z.number().int().min(0),
	note: z.string().nullable(),
});
export type PlanEntitlement = z.infer<typeof PlanEntitlementSchema>;

/**
 * A row of `finance.entitlement_grants` — a manual override (comp, trial, enterprise negotiation).
 * A grant may only RAISE an effective limit, never lower it, so a misconfigured grant can never
 * suffocate a paying subject.
 */
export const EntitlementGrantSchema = z.object({
	id: uuid,
	subjectType: SubscriptionSubject,
	subjectId: uuid,
	entitlementKey: EntitlementKey,
	limitValue: z.number().int().min(0).nullable(),
	isUnlimited: z.boolean(),
	flagValue: z.boolean().nullable(),
	reason: z.string().min(1),
	grantedBy: uuid.nullable(),
	startsAt: timestamp,
	expiresAt: timestamp.nullable(),
	createdAt: timestamp,
});
export type EntitlementGrant = z.infer<typeof EntitlementGrantSchema>;

/**
 * A row of `finance.allowance_periods` — metered distribution for one subject and key.
 *
 * `bufferUnits` is the anti-burst drip (3 per 10h free / 5 per 10h Pro). A spend needs BOTH a buffer
 * token and weekly headroom, so a week's allowance can never be dumped into one hour of spam. The
 * drip magnitude, the hold cap and the weekly ceiling are all tunable dials — `analytics.events`
 * (`allowance.*`) is the substrate they get re-fitted against.
 */
export const AllowancePeriodSchema = z.object({
	id: uuid,
	subjectType: SubscriptionSubject,
	subjectId: uuid,
	entitlementKey: EntitlementKey,
	periodStart: timestamp,
	periodEnd: timestamp,
	grantedUnits: z.number().int().min(0),
	consumedUnits: z.number().int().min(0),
	/** Provenance, so the UI can say "50 base + 20 earned". */
	baseUnits: z.number().int(),
	standingBonusUnits: z.number().int(),
	bufferUnits: z.number().int().min(0),
	bufferCap: z.number().int().min(0),
	bufferRefreshedAt: timestamp,
	createdAt: timestamp,
});
export type AllowancePeriod = z.infer<typeof AllowancePeriodSchema>;

/** A row of `finance.allowance_ledger` — append-only. Negative `units` is a refund. */
export const AllowanceLedgerEntrySchema = z.object({
	id: uuid,
	periodId: uuid,
	subjectType: SubscriptionSubject,
	subjectId: uuid,
	entitlementKey: EntitlementKey,
	units: z.number().int(),
	reason: z.string().min(1),
	refTable: z.string().nullable(),
	refId: uuid.nullable(),
	createdAt: timestamp,
});
export type AllowanceLedgerEntry = z.infer<typeof AllowanceLedgerEntrySchema>;
// #endregion

// #region Read projections
/**
 * The resolved value of one entitlement for one subject. `limit === null` means UNLIMITED;
 * `limit === 0` means the subject's plan does not grant it at all.
 */
export const ResolvedEntitlementSchema = z.object({
	key: EntitlementKey,
	kind: EntitlementKind,
	limit: z.number().int().min(0).nullable(),
	enabled: z.boolean(),
	/** Live consumption, where the key has a countable footprint. */
	used: z.number().int().min(0).nullable(),
	/** `limit - used`, or `null` when unlimited. */
	remaining: z.number().int().min(0).nullable(),
	/** Which layer produced the value — for the "why" tooltip and for support. */
	source: z.enum(["plan", "standing", "grant"]),
});
export type ResolvedEntitlement = z.infer<typeof ResolvedEntitlementSchema>;

/** The whole entitlement picture for one subject — what a settings/billing surface renders. */
export const EntitlementSnapshotSchema = z.object({
	subjectType: SubscriptionSubject,
	subjectId: uuid,
	audience: PlanAudience,
	planCode: z.string(),
	planLabel: z.string(),
	/** The earned rung, 1–5. `null` for buyer-only subjects, which carry no Standing. */
	standingLevel: z.number().int().min(1).max(5).nullable(),
	entitlements: z.array(ResolvedEntitlementSchema),
	allowances: z.array(AllowancePeriodSchema),
});
export type EntitlementSnapshot = z.infer<typeof EntitlementSnapshotSchema>;
// #endregion

// #region Pure helpers (mirror the SQL resolvers exactly)
/** `null` limit = unlimited. Mirrors `finance.fn_effective_limit`'s NULL contract. */
export const UNLIMITED = null;

/**
 * Apply the earned ladder to a plan value — the TypeScript twin of the `scaling` branch inside
 * `finance.fn_effective_limit`. Kept pure so a client can preview "what would Pro give me at my
 * rung" without a round trip.
 */
export function scaleEntitlement(
	entitlement: Pick<PlanEntitlement, "limitValue" | "isUnlimited" | "scaling" | "multiplierBp">,
	rung: { listingBase: number; proposalBonus: number } | null,
): number | null {
	if (entitlement.isUnlimited) return UNLIMITED;

	switch (entitlement.scaling) {
		case "standing_base":
			return Math.floor(((rung?.listingBase ?? 0) * entitlement.multiplierBp) / 10000);
		case "standing_bonus":
			return (entitlement.limitValue ?? 0) + (rung?.proposalBonus ?? 0);
		default:
			return entitlement.limitValue ?? 0;
	}
}

/** Remaining units in a metered period, floored at zero. */
export function allowanceRemaining(
	period: Pick<AllowancePeriod, "grantedUnits" | "consumedUnits">,
): number {
	return Math.max(period.grantedUnits - period.consumedUnits, 0);
}

/**
 * Can this subject spend `units` right now? Mirrors `finance.fn_consume_allowance`'s guard: BOTH the
 * weekly ceiling and the anti-burst buffer must permit it.
 */
export function canConsumeAllowance(period: AllowancePeriod, units = 1): boolean {
	if (allowanceRemaining(period) < units) return false;
	if (period.bufferCap > 0 && period.bufferUnits < units) return false;
	return true;
}
// #endregion
