import {
	DATA_EXPORT_POLICY,
	type DataExportRefusal,
	isDataExportRefusal,
} from "@projective/types/org";
import { fail, type ServiceResult } from "../ServiceResult.ts";
import type { RpcError } from "./account-lifecycle-refusals.ts";

/**
 * data-export-refusals — the pure half of {@link DataExportBackendService}'s person-facing doors:
 * turning what `org.request_data_export` raises into what the person reads (Decision #450).
 *
 * Each refusal is the exception MESSAGE (SQLSTATE `P0001`), one {@link DataExportRefusal} code;
 * `rate_limited` carries the next allowed moment in DETAIL. `28000` is no signed-in subject, `42501`
 * an account with no profile yet.
 */

const REFUSALS: Readonly<Record<DataExportRefusal, { status: number; message: string }>> = {
	reauth_required: {
		status: 403,
		message:
			`For your security, sign in again to request your data. It has to be within ${DATA_EXPORT_POLICY.recentSignInMinutes} minutes of signing in.`,
	},
	already_pending: { status: 409, message: "Your copy is already being prepared." },
	rate_limited: { status: 429, message: "You can request one copy a day." },
	account_closing: {
		status: 409,
		message: "Your account is scheduled for deletion. Cancel that first to request a copy.",
	},
};

/**
 * The {@link ServiceResult} for an rpc error from the data export doors. A refusal keeps its code in
 * `details.refusal`; `rate_limited` adds `details.retryAt`. Anything else is an outage, with the
 * database's reason kept in `details.reason`.
 */
export function dataExportFailure(error: RpcError): ServiceResult<never> {
	if (error.code === "28000") {
		return fail(401, { message: "Your session has expired. Please sign in again." });
	}
	if (error.code === "42501" && error.message === "profile_required") {
		return fail(403, { message: "Finish signing up before requesting your data." });
	}
	if (error.code === "P0001" && isDataExportRefusal(error.message)) {
		const code = error.message;
		const copy = REFUSALS[code];
		const retryAt = code === "rate_limited" ? error.details?.trim() || null : null;
		return fail(copy.status, {
			message: copy.message,
			details: retryAt ? { refusal: code, retryAt } : { refusal: code },
		});
	}
	return fail(503, {
		message: "We couldn't reach the server. Try again in a moment.",
		details: { reason: error.message, code: error.code ?? null },
	});
}
