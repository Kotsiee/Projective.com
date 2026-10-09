import {
	AccountRefusal,
	DELETION_BLOCKER_COPY,
	DELETION_CONFIRMATION,
	DeletionBlocker,
	HANDLE_POLICY,
	isAccountRefusal,
} from "@projective/types/org";
import { fail, type ServiceResult } from "../ServiceResult.ts";

/**
 * account-lifecycle-refusals — the pure half of {@link AccountLifecycleBackendService}: turning what
 * the 00001060 definers raise into what the person reads. Kept apart from the service so it is
 * testable without a Supabase client.
 *
 * Each refusal is the exception MESSAGE (SQLSTATE `P0001`), exactly one {@link AccountRefusal} code.
 * `handle_refused` carries the namespace rule's own sentence in DETAIL, `blocked` the blocker codes
 * (comma-separated). `28000` is no signed-in subject, `42501` an account with no profile yet.
 */

// #region Shapes
/** The error a PostgREST rpc call answers with. */
export interface RpcError {
	message: string;
	code?: string;
	details?: string | null;
}
// #endregion

// #region Refusals
const REFUSALS: Readonly<Record<AccountRefusal, { status: number; message: string }>> = {
	handle_unchanged: { status: 422, message: "That's already your handle." },
	handle_locked: {
		status: 409,
		message:
			`You've changed your handle twice in ${HANDLE_POLICY.windowDays} days, so it's locked for ${HANDLE_POLICY.lockDays} days.`,
	},
	handle_refused: { status: 422, message: "That handle can't be used." },
	account_closing: {
		status: 409,
		message: "Your account is scheduled for deletion. Cancel that first to make changes.",
	},
	confirmation_mismatch: {
		status: 422,
		message: `Type ${DELETION_CONFIRMATION} exactly to confirm.`,
	},
	already_scheduled: { status: 409, message: "That's already scheduled." },
	not_freelancer: { status: 409, message: "You don't have a freelancer profile to remove." },
	blocked: { status: 409, message: "Something still needs finishing first." },
	not_scheduled: { status: 404, message: "Nothing is scheduled to cancel." },
	scope_invalid: { status: 422, message: "Choose what to cancel." },
};

/** The blocker codes a `blocked` refusal carried, in the order the definer found them. */
export function blockersFrom(details: string | null | undefined): DeletionBlocker[] {
	return (details ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter((part): part is DeletionBlocker => DeletionBlocker.safeParse(part).success);
}

/**
 * The {@link ServiceResult} for an rpc error from the lifecycle definers. A refusal keeps its code in
 * `details.refusal`; a `blocked` one lists its blockers in `details.blockers` and leads with the first
 * blocker's sentence; a handle refusal carries the namespace rule's sentence as `errors.handle`.
 * Anything else is an outage, with the database's reason kept in `details.reason`.
 */
export function lifecycleFailure(error: RpcError): ServiceResult<never> {
	if (error.code === "28000") {
		return fail(401, { message: "Your session has expired. Please sign in again." });
	}
	if (error.code === "42501" && error.message === "profile_required") {
		return fail(403, { message: "Finish signing up before changing your account." });
	}
	if (error.code === "P0001" && isAccountRefusal(error.message)) {
		const code = error.message;
		const copy = REFUSALS[code];
		if (code === "handle_refused") {
			const message = error.details?.trim() || copy.message;
			return fail(copy.status, {
				message,
				errors: { handle: message },
				details: { refusal: code },
			});
		}
		if (code === "blocked") {
			const blockers = blockersFrom(error.details);
			return fail(copy.status, {
				message: blockers.length > 0 ? DELETION_BLOCKER_COPY[blockers[0]] : copy.message,
				details: { refusal: code, blockers: blockers.join(",") },
			});
		}
		return fail(copy.status, {
			message: copy.message,
			errors: code === "confirmation_mismatch" ? { confirmation: copy.message } : undefined,
			details: { refusal: code },
		});
	}
	return fail(503, {
		message: "We couldn't reach the server. Try again in a moment.",
		details: { reason: error.message, code: error.code ?? null },
	});
}
// #endregion
