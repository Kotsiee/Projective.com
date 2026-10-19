import { BUSINESS_NOT_ACTIVE_REASON } from "@projective/types/workspace";

/** The parts of a PostgREST error a business-lifecycle refusal fills. */
export interface BusinessLifecycleError {
	code?: string;
	message?: string;
	details?: string | null;
}

/**
 * What a `business_not_active` refusal carries for the screen to word (Decision #243): `reason`, and —
 * when the database's DETAIL named them — the business's lifecycle `status` (`draft` · `archived`) and
 * `businessId`, so a screen that knows the business's name can say which one (a transfer touches two
 * wallets).
 */
export type BusinessNotActiveDetails = Record<string, string> & {
	reason: typeof BUSINESS_NOT_ACTIVE_REASON;
};

/** The envelope a money door answers a `business_not_active` refusal with. */
export interface BusinessNotActiveRefusal {
	status: 409;
	message: string;
	details: BusinessNotActiveDetails;
}

/** The SQLSTATE `org.fn_assert_business_active` / `org.fn_assert_business_not_archived` raise. */
const NOT_ACTIVE_SQLSTATE = "55000";
const PREFIX = /^(?:ERROR:\s*)?business_not_active:\s*/i;
const STATUSES: ReadonlySet<string> = new Set(["draft", "active", "archived"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map a draft or archived business's refusal (`55000 business_not_active: …` — BB5's active-only doors,
 * and the money-in doors an archived business refuses, Decision #248 (k)) onto a 409 whose
 * `details.reason` is `business_not_active`, consistent with the billing doors (#247), plus the
 * business's `status` and `businessId` when the DETAIL names them — so a screen words it from the
 * business refusal map, asking for the one act the status needs. The message is the database's own
 * sentence. `null` for any other error, a `55000` without the prefix included (a trigger, a seat cap).
 */
export function businessNotActiveRefusal(
	error: BusinessLifecycleError | null | undefined,
): BusinessNotActiveRefusal | null {
	if (error?.code !== NOT_ACTIVE_SQLSTATE || !PREFIX.test(error.message ?? "")) return null;
	const rest = (error.message ?? "").replace(PREFIX, "").replace(/\s+/g, " ").trim().slice(0, 200);
	const sentence = rest ? `${rest[0].toUpperCase()}${rest.slice(1)}` : "This business isn't active";
	const details: BusinessNotActiveDetails = { reason: BUSINESS_NOT_ACTIVE_REASON };
	const detail = parseDetail(error.details);
	if (typeof detail.status === "string" && STATUSES.has(detail.status)) {
		details.status = detail.status;
	}
	if (typeof detail.business_id === "string" && UUID.test(detail.business_id)) {
		details.businessId = detail.business_id.toLowerCase();
	}
	return {
		status: 409,
		message: /[.!?]$/.test(sentence) ? sentence : `${sentence}.`,
		details,
	};
}

// #region Helpers
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
// #endregion
