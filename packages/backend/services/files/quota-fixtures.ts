import type { AssetOwnerType, FilesSim, StorageQuota } from "@projective/types/files";
import { PLAN_STORAGE_MIB } from "@projective/types/files";
import type { PlanCode } from "@projective/types/finance";
import { usedMibFor } from "./assets-fixtures.ts";

/**
 * files quota fixtures — the fat {@link FilesBackendService}'s answer for a principal's storage
 * allowance while `FILES_BACKEND_LIVE` is off.
 *
 * **Storage is not a new entitlement engine.** It rides the existing one (Decision #58): the ladder is a
 * `finance.plan_entitlements` row under `storage_megabytes`, resolved through
 * `fn_effective_limit` / `fn_footprint_usage`. So the ONLY thing this module does is resolve a plan for
 * the owner, read the ladder ({@link PLAN_STORAGE_MIB}, the SSOT), and measure the corpus. When the gate
 * flips, the plan lookup becomes the real subscription read and the usage becomes `fn_footprint_usage` —
 * the projection does not change shape.
 *
 * **THE UNIT IS MEBIBYTES.** Every boundary-crossing figure in the entitlement engine is Postgres
 * `int4`. A 25 GB allowance in BYTES is 26,843,545,600, an order of magnitude past int4, which either
 * errors or silently wraps. In MiB it is 25,600. Never denominate a storage limit in bytes anywhere that
 * touches the engine.
 *
 * **Enforcement is FAIL-OPEN and param-gated** (`security.platform_params.storage_quota_enforced`,
 * `DEFAULT false`), exactly like `proposal_allowance_enforced`. The cap METERS from day one and refuses
 * nothing until a human flips it, so {@link StorageQuota.enforced} is projected to the client to keep
 * "you are over your allowance" (a fact) apart from "this upload will be refused" (a consequence that
 * may not exist yet).
 */

// #region Plan resolution

/**
 * The plan an owner resolves to.
 *
 * Deliberately a lookup on the owner KIND rather than on the individual, because that is what the live
 * path does: an entity's allowance comes from the entity's subscription, not from whoever happens to be
 * reading. The acting individual is seeded onto the free tier so the meter has a real ceiling to draw —
 * an unlimited default would make the whole warning ladder unreachable in development.
 */
function planFor(ownerType: AssetOwnerType): PlanCode {
	switch (ownerType) {
		case "user":
			return "individual_free";
		case "team":
			return "team_free";
		case "business":
			return "business_free";
		case "organisation":
			return "organisation";
	}
}

/** Human tier name for the meter's caption. */
function tierLabelFor(plan: PlanCode): string {
	if (plan === "organisation") return "Organisation";
	return plan.endsWith("_pro") ? "Pro" : "Free";
}

// #endregion

// #region Simulation overlay

/**
 * The used-MiB figure a simulated band implies.
 *
 * The bands are re-derived from a RATIO of the real limit rather than hard-coded MiB figures, so the
 * axis keeps working when the ladder changes — a seeded "24,000 MiB used" would quietly stop meaning
 * "critical" the day the free tier grows.
 */
function simUsage(band: NonNullable<FilesSim["storageQuota"]>, limitMib: number): number {
	switch (band) {
		case "empty":
			return 0;
		case "healthy":
			return Math.round(limitMib * 0.34);
		case "warning":
			return Math.round(limitMib * 0.82);
		case "critical":
			return Math.round(limitMib * 0.94);
		case "exceeded":
			return Math.round(limitMib * 1.08);
		case "unlimited":
			return Math.round(limitMib * 0.61);
	}
}

// #endregion

// #region Resolution

/** Round to one decimal — a measurement, not a boundary-crossing limit. */
function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

/**
 * Resolve a principal's storage allowance.
 *
 * Every derived figure is computed HERE and rendered verbatim by the client: it never subtracts,
 * divides or totals them, for the same reason `/wallet` never lets the client do money arithmetic
 * (Decision #60). `pct` is clamped for the meter, which is exactly why `quotaState` re-derives the band
 * from `usedMib`/`limitMib` instead of reading it — a value that tops out at 100 cannot tell "exactly
 * full" from "600 MiB over", and the band is what decides whether the surface says you are fine.
 */
export function resolveQuota(params: {
	ownerType: AssetOwnerType;
	ownerId: string;
	sim?: FilesSim;
}): StorageQuota {
	const band = params.sim?.storageQuota;
	const plan = band === "unlimited" ? "organisation" : planFor(params.ownerType);

	// `null` is the UNLIMITED sentinel — not `0` (a real allowance of nothing) and not a huge number
	// (which would eventually be rendered as a figure and read as a promise).
	const limitMib = PLAN_STORAGE_MIB[plan];

	const measured = usedMibFor(params.ownerType, params.ownerId);
	const usedMib = band && limitMib !== null
		? round1(simUsage(band, limitMib))
		: band === "empty"
		? 0
		: round1(measured);

	const remainingMib = limitMib === null ? null : round1(Math.max(0, limitMib - usedMib));
	const pct = limitMib === null || limitMib === 0
		? 0
		: Math.min(100, Math.max(0, round1((usedMib / limitMib) * 100)));

	return {
		limitMib,
		usedMib,
		remainingMib,
		pct,
		source: "plan",
		planCode: plan,
		tierLabel: tierLabelFor(plan),
		// Fail-open: the cap is measured and shown, and refuses nothing until a human flips the param.
		enforced: false,
	};
}

// #endregion

// #region Metering

/** What metering an upload against an allowance concluded. */
export interface QuotaMeter {
	/** Whether the upload may proceed. `true` whenever enforcement is off — the fail-open contract. */
	allowed: boolean;
	/** Whether it would push the owner past their allowance, regardless of enforcement. */
	wouldExceed: boolean;
	/** MiB by which it overshoots; `0` when it fits or the allowance is unlimited. */
	overageMib: number;
	/**
	 * A human note for a warning banner — present whenever `wouldExceed`, refusal or not. Absent when
	 * the upload fits, so a surface never has to decide whether an empty string means "fine".
	 */
	note: string | null;
	/**
	 * The analytics event key the APP LAYER must emit on a refusal.
	 *
	 * It is returned rather than written here on purpose: the live refusal is a `RAISE` inside the
	 * database, and Postgres has no autonomous transactions — the raise rolls back the
	 * `entitlement.denied` row written moments earlier, so the denial telemetry goes dark exactly when
	 * enforcement starts mattering (Decision #58, flagged item (j)). Emitting from the app layer, after
	 * the refusal has surfaced, is the only place it survives.
	 */
	deniedEvent: string | null;
}

const MIB = 1024 * 1024;

/**
 * Meter an upload against an allowance.
 *
 * A pre-flight the SERVER owns even though a pure client-side twin exists (`canAccept`): the client's
 * `usedMib` is a snapshot, and two concurrent uploads would both pass it.
 */
export function meterUpload(quota: StorageQuota, bytes: number): QuotaMeter {
	if (quota.limitMib === null || !Number.isFinite(bytes) || bytes <= 0) {
		return { allowed: true, wouldExceed: false, overageMib: 0, note: null, deniedEvent: null };
	}
	const projected = quota.usedMib + bytes / MIB;
	const overageMib = Math.max(0, Math.round((projected - quota.limitMib) * 10) / 10);
	const wouldExceed = overageMib > 0;
	if (!wouldExceed) {
		return { allowed: true, wouldExceed: false, overageMib: 0, note: null, deniedEvent: null };
	}
	return {
		allowed: !quota.enforced,
		wouldExceed: true,
		overageMib,
		note: quota.enforced
			? `This upload is ${overageMib} MB over your storage allowance.`
			: `This upload takes you ${overageMib} MB past your storage allowance.`,
		deniedEvent: quota.enforced ? "entitlement.denied" : null,
	};
}

// #endregion
