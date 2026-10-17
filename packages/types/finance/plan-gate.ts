import { z } from "zod";

/**
 * The plan gates (Decision #230 (e)): a paid act the subject's plan does not include is refused by
 * the database with SQLSTATE `PK402`, MESSAGE `entitlement: <key>: <reason>` and the key again in
 * HINT. The business gates (`finance.fn_assert_business_entitlement`) sit behind one platform switch,
 * `business_plan_gates_enforced`, seeded ON and set per environment. The database is the authority;
 * these are the shapes the API and the islands share for its refusal, and the Dev Context Switcher's
 * override of it.
 */

// #region Refusal
/** The SQLSTATE every plan gate raises. */
export const PLAN_GATE_SQLSTATE = "PK402";

/** The reason key: the database message's prefix and `details.reason` on the envelope. */
export const PLAN_GATE_REASON = "entitlement";

/** The business entitlements refused behind `business_plan_gates_enforced` (BUSINESSES_AUDIT BF33–BF35). */
export const BusinessPlanGateKey = z.enum([
	"business_managers",
	"intervaled_invoicing",
	"pooled_wallet_full",
]);
export type BusinessPlanGateKey = z.infer<typeof BusinessPlanGateKey>;

/**
 * `details` of a plan-gate refusal (HTTP 402): the entitlement key the plan lacks, which the surface
 * turns into its upgrade notice. `null` only when the database named none.
 */
export const PlanGateDetailsSchema = z.object({
	reason: z.literal(PLAN_GATE_REASON),
	entitlement: z.string().nullable(),
});
export type PlanGateDetails = z.infer<typeof PlanGateDetailsSchema>;

/** Read a refusal's `details` as a plan gate's, or `null` when it is any other refusal. */
export function readPlanGateDetails(details: unknown): PlanGateDetails | null {
	const parsed = PlanGateDetailsSchema.safeParse(details);
	return parsed.success ? parsed.data : null;
}
// #endregion

// #region Dev override
/**
 * The Dev Context Switcher's business plan gates position (`businessPlanGates`): `enforced` turns the
 * gates on where the environment has the switch off; `free` also resolves the business as on Business
 * Free, so a Pro business meets every upgrade notice. Absent = no override (the environment decides).
 * There is no "off" override: an override may only make a gate STRICTER, which is why the database
 * honours it from any caller. Sent only by a development build.
 */
export const PlanGatesOverride = z.enum(["enforced", "free"]);
export type PlanGatesOverride = z.infer<typeof PlanGatesOverride>;

/** The cookie that carries {@link PlanGatesOverride} from the browser to the API routes. */
export const PLAN_GATES_OVERRIDE_COOKIE = "pj.dev.plan-gates";

/** The request header that carries it from the API to PostgREST (`finance.fn_dev_plan_gates`). */
export const PLAN_GATES_OVERRIDE_HEADER = "x-pj-dev-plan-gates";

/** Read the override from a cookie value; anything unrecognised means "no override". */
export function parsePlanGatesOverride(raw: string | null | undefined): PlanGatesOverride | null {
	const parsed = PlanGatesOverride.safeParse(raw?.trim());
	return parsed.success ? parsed.data : null;
}
// #endregion
