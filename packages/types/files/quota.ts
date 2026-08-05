import { z } from "zod";
import type { PlanCode } from "../finance/plans.ts";

/**
 * files.quota — the Zod SSOT for a principal's storage allowance.
 *
 * **THE UNIT IS MEBIBYTES, AND THAT IS NOT A STYLE CHOICE.** Storage rides the existing entitlement
 * engine (Decision #58): the ladder is a `finance.plan_entitlements` row under the key
 * `storage_megabytes`, and it is resolved through `fn_effective_limit` / `fn_footprint_usage` /
 * `fn_footprint_remaining`. Every one of those columns and return types is `integer` — Postgres
 * `int4`, maximum 2,147,483,647. A 25 GB allowance denominated in BYTES is 26,843,545,600, which
 * overflows int4 by an order of magnitude and would either error or silently wrap. In MiB the same
 * allowance is 25,600, and even the largest tier on the ladder is five digits. So: **`limitMib` is the
 * boundary-crossing figure and must always be an integer number of MiB. Never denominate a storage
 * limit in bytes anywhere that touches the entitlement engine.**
 *
 * Bytes remain the right unit for a single object (a file size fits in a `bigint` column and never
 * goes near `plan_entitlements`), which is why {@link canAccept} takes bytes and converts at the
 * boundary rather than asking its callers to pre-divide.
 *
 * Enforcement ships **fail-open** behind `security.platform_params.storage_quota_enforced`
 * (`DEFAULT false`), exactly like `proposal_allowance_enforced` — the cap METERS from day one and
 * refuses nothing until a human flips it. {@link StorageQuota.enforced} is that parameter projected
 * to the client so the interface can tell "you are over your allowance" (a fact) apart from "this
 * upload will be refused" (a consequence that may not exist yet).
 *
 * Only enum/array/string/number/boolean primitives are used so the module stays stable across Zod
 * majors.
 */

// #region Unit constants

/** One mebibyte in bytes. The atom of the storage ladder. */
export const MIB = 1024 * 1024;
/** One gibibyte in bytes. */
export const GIB = MIB * 1024;
/** One tebibyte in bytes. */
export const TIB = GIB * 1024;

// #endregion

// #region Vocabulary

/**
 * Where an allowance came from. `plan` is the subscription ladder; `grant` is a
 * `finance.entitlement_grants` override — a per-subject exception with its own reason and window,
 * which exists so support can unblock a customer without inventing a plan for them.
 */
export const QuotaSource = z.enum(["plan", "grant"]);
export type QuotaSource = z.infer<typeof QuotaSource>;

/**
 * The band an allowance is sitting in — the one derived value the whole surface (meter tone, empty
 * state, upgrade nudge, upload refusal copy) branches on, so it is computed in exactly one place.
 */
export const StorageQuotaState = z.enum([
	"empty",
	"healthy",
	"warning",
	"critical",
	"exceeded",
]);
export type StorageQuotaState = z.infer<typeof StorageQuotaState>;

// #endregion

// #region Quota projection

/**
 * A principal's resolved storage allowance. Server-computed in full: the client renders these figures
 * and never subtracts, divides or totals them, for the same reason `/wallet` never lets the client do
 * money arithmetic (Decision #60).
 */
export const StorageQuotaSchema = z.object({
	/**
	 * The allowance in MiB, or `null` for **UNLIMITED**. `null` is the unlimited sentinel — not `0`,
	 * which means a real allowance of nothing, and not a huge number, which would eventually be
	 * rendered as a figure and read as a promise.
	 */
	limitMib: z.number().int().min(0).nullable(),
	/**
	 * Consumed MiB. May be fractional — it is a measurement, not a boundary-crossing limit, so it is
	 * not bound by the int4 constraint that governs {@link limitMib}.
	 */
	usedMib: z.number().min(0),
	/** Headroom in MiB, or `null` when unlimited. Server-computed; never `limit - used` client-side. */
	remainingMib: z.number().nullable(),
	/**
	 * Consumption as a percentage, clamped to 0–100 for the meter, and `0` when unlimited (a share of
	 * an unbounded whole is not a meaningful number, and drawing one would invent a ceiling).
	 *
	 * This is a DISPLAY figure. {@link quotaState} deliberately re-derives the band from
	 * `usedMib`/`limitMib` rather than reading it, so a clamped percentage can never mask an overage.
	 */
	pct: z.number().min(0).max(100),
	source: QuotaSource,
	/** The plan the allowance resolved through (`finance.plans.code`). */
	planCode: z.string().min(1).max(40),
	/** Human tier name for the meter's caption ("Free", "Pro"). */
	tierLabel: z.string().min(1).max(40),
	/**
	 * Whether `security.platform_params.storage_quota_enforced` is on. While `false` the cap is
	 * measured and shown but never refuses an upload.
	 */
	enforced: z.boolean(),
});
export type StorageQuota = z.infer<typeof StorageQuotaSchema>;

// #endregion

// #region The ladder

/**
 * The storage allowance per plan, in MiB. `null` is unlimited.
 *
 * Typed as an exhaustive `Record<PlanCode, …>`, so adding a plan to `finance/plans.ts` without giving
 * it an allowance is a compile error rather than a runtime `undefined` that would read as "no quota"
 * — which, depending on the branch, means either unlimited or zero. Neither is a safe default.
 *
 * `PlanCode` is imported as a TYPE only, so this stays erased at runtime and the files domain gains no
 * runtime dependency on the finance domain.
 */
export const PLAN_STORAGE_MIB: Record<PlanCode, number | null> = {
	individual_free: 25_600,
	individual_pro: 153_600,
	team_free: 25_600,
	team_pro: 512_000,
	business_free: 25_600,
	business_pro: 512_000,
	organisation_free: 25_600,
	/** Organisation is the negotiated tier — `is_unlimited = true` on its entitlement row. */
	organisation: null,
};

// #endregion

// #region Pure helpers

/**
 * The band an allowance is in.
 *
 * Derived from `usedMib`/`limitMib`, never from the clamped {@link StorageQuota.pct}: a display value
 * that tops out at 100 cannot distinguish "exactly full" from "600 MiB over", and the band is what
 * decides whether the surface says you are fine or that you need to act.
 *
 * `empty` outranks everything — a library with nothing in it is not "healthy", it is unused, and the
 * two want different empty states.
 */
export function quotaState(q: StorageQuota): StorageQuotaState {
	if (q.usedMib <= 0) return "empty";
	if (q.limitMib === null) return "healthy";
	if (q.limitMib === 0) return "exceeded";
	const ratio = (q.usedMib / q.limitMib) * 100;
	if (ratio >= 100) return "exceeded";
	if (ratio >= 90) return "critical";
	if (ratio >= 75) return "warning";
	return "healthy";
}

/** Round to one decimal place and drop a trailing `.0`, so `25` never renders as `25.0`. */
function trim(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * A MiB figure as a human string — `"820 MB"`, `"25 GB"`, `"1.5 TB"`.
 *
 * The magnitudes are BINARY (1024-stepped, matching the stored unit) while the suffixes are the
 * familiar `KB`/`MB`/`GB`/`TB`. That pairing is deliberate: the product sells "25 GB", every competitor
 * writes "25 GB", and rendering the pedantically-correct "25 GiB" would make a person wonder whether
 * they had been given something different from what they bought.
 */
export function formatMib(mib: number): string {
	if (!Number.isFinite(mib) || mib <= 0) return "0 MB";
	if (mib < 1) return `${Math.max(1, Math.round(mib * 1024))} KB`;
	if (mib < 1024) return `${trim(mib)} MB`;
	const gib = mib / 1024;
	if (gib < 1024) return `${trim(gib)} GB`;
	return `${trim(gib / 1024)} TB`;
}

/**
 * Whether an upload of `bytes` fits.
 *
 * Returns `true` while enforcement is off — the fail-open contract is expressed HERE, in the one
 * predicate every caller shares, rather than left for each call site to remember. An unlimited
 * allowance and a non-positive size also pass trivially.
 *
 * This is a client-side PRE-FLIGHT so the interface can warn before a person waits through an upload.
 * It is never the gate: the server re-checks against live usage, because the client's `usedMib` is a
 * snapshot and two concurrent uploads would both pass it.
 */
export function canAccept(q: StorageQuota, bytes: number): boolean {
	if (!q.enforced) return true;
	if (q.limitMib === null) return true;
	if (!Number.isFinite(bytes) || bytes <= 0) return true;
	return q.usedMib + bytes / MIB <= q.limitMib;
}

// #endregion
