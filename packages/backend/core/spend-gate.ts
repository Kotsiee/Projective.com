import {
	SPEND_GATE_REFUSAL,
	SPEND_GATE_SQLSTATE,
	type SpendGateDetails,
	SpendGateReason,
	SpendGateRefTable,
} from "@projective/types/finance";

/** The parts of a PostgREST error the spend gate fills. */
export interface SpendGateError {
	code?: string;
	message?: string;
	details?: string | null;
	hint?: string | null;
}

/** The envelope every door answers a spend-gate refusal with. */
export interface SpendGateRefusal {
	status: 403;
	message: string;
	details: SpendGateDetails;
}

// `kyb_required: …` · `over_limit: …` · `needs_approval: …` (finance.fn_assert_business_spend, and
// the approval redeemer it calls).
const PREFIX = /^(?:ERROR:\s*)?([a-z_]+):\s*/i;

/**
 * The reason of a business spend-gate refusal, or `null` for any other error — a PK403 from the
 * earning gate, the persona gate or a business-authority check is not one, and neither is a PA403
 * whose message carries no gate prefix.
 */
export function spendGateReason(error: SpendGateError | null | undefined): SpendGateReason | null {
	const prefix = PREFIX.exec(error?.message ?? "")?.[1]?.toLowerCase();
	const parsed = SpendGateReason.safeParse(prefix);
	if (!parsed.success) return null;
	return error?.code === SPEND_GATE_SQLSTATE[parsed.data] ? parsed.data : null;
}

/**
 * Map a spend-gate refusal onto a 403 whose `details` carry the reason and, when the database named
 * it, the spend an approval request would bind to — so a screen can offer "Request approval" for
 * exactly that spend. `null` when the error is not the gate's.
 */
export function spendGateRefusal(
	error: SpendGateError | null | undefined,
): SpendGateRefusal | null {
	const reason = spendGateReason(error);
	if (!reason) return null;
	const detail = parseDetail(error?.details);
	return {
		status: 403,
		message: SPEND_GATE_REFUSAL[reason],
		details: {
			reason,
			walletId: uuidOrNull(detail.wallet_id),
			refTable: SpendGateRefTable.safeParse(detail.ref_table).data ?? null,
			refId: uuidOrNull(detail.ref_id),
			amountMinor: minorOrNull(detail.amount_minor),
			thresholdMinor: minorOrNull(detail.threshold_minor),
		},
	};
}

// #region Helpers
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDetail(raw: string | null | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		const value: unknown = JSON.parse(raw);
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? value as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
}

function uuidOrNull(value: unknown): string | null {
	return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function minorOrNull(value: unknown): number | null {
	const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
// #endregion
