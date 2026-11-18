import {
	EmailRefusal,
	type EmailVerifyOutcome,
	MAX_USER_EMAILS,
	SIGN_IN_CHANGE_LIMIT,
	type UserEmail,
	UserEmailSchema,
} from "@projective/types/org";
import { fail, type FailureDetails, type ServiceResult } from "../ServiceResult.ts";

/**
 * emails-refusals — the pure half of {@link EmailsBackendService}: turning what the 00001050 email
 * functions raise into what the person reads, and their rows into the Zod SSOT shape. Kept apart from
 * the service so it is testable without a Supabase client.
 *
 * The definers raise each refusal as the exception MESSAGE with SQLSTATE `P0001`, the message being
 * exactly one {@link EmailRefusal} code; two conditions carry their own SQLSTATE instead — `28000`
 * (no signed-in subject) and `42501` (`profile_required`: an account that has not finished onboarding).
 */

// #region Refusals
/** Suggested HTTP status + calm sentence for one refusal code. */
interface RefusalCopy {
	status: number;
	message: string;
}

const REFUSALS: Record<EmailRefusal, RefusalCopy> = {
	email_invalid: { status: 422, message: "Enter an email address like name@example.com." },
	email_exists: { status: 409, message: "That address is already on your account." },
	email_limit: {
		status: 409,
		message: `You can keep up to ${MAX_USER_EMAILS} addresses. Remove one to add another.`,
	},
	email_not_found: { status: 404, message: "We couldn't find that address on your account." },
	email_unverified: {
		status: 409,
		message: "Confirm that address first — only a confirmed address can be your primary.",
	},
	email_is_primary: {
		status: 409,
		message: "That's your primary address. Make another confirmed address primary first.",
	},
	email_is_sign_in: {
		status: 409,
		message: "You sign in with that address, so it can't be removed here.",
	},
	email_in_use: {
		status: 409,
		message: "That address is already confirmed on another Projective account.",
	},
	token_invalid: {
		status: 400,
		message: "That confirmation link isn't valid. Send a new one from your account settings.",
	},
	token_expired: {
		status: 410,
		message: "That confirmation link has expired. Send a new one from your account settings.",
	},
	token_used: { status: 409, message: "That confirmation link has already been used." },
	token_wrong_account: {
		status: 403,
		message:
			"That confirmation link belongs to a different account. Sign in to that account to use it.",
	},
	sign_in_already: { status: 409, message: "You already sign in with that address." },
	sign_in_unverified: {
		status: 409,
		message: "Confirm that address first — only a confirmed address can be used to sign in.",
	},
	sign_in_limit: {
		status: 429,
		message:
			`You can change your sign-in address ${SIGN_IN_CHANGE_LIMIT.max} times in ${SIGN_IN_CHANGE_LIMIT.windowDays} days. Try again later.`,
	},
	sign_in_unavailable: {
		status: 409,
		message: "We couldn't move your sign-in to that address. Contact support and we'll help.",
	},
	account_closing: {
		status: 409,
		message:
			"Your account is scheduled for deletion, so its sign-in address can't change. Cancel the deletion first.",
	},
	password_required: {
		status: 409,
		message: "Your account doesn't have a password yet. Set one under Password, then try again.",
	},
	password_incorrect: { status: 422, message: "That password isn't right." },
};

/** The form field a refusal belongs to, so a form can show it beside that field. */
const REFUSAL_FIELD: Partial<Record<EmailRefusal, string>> = {
	email_invalid: "email",
	password_incorrect: "password",
};

/** The sentence a person reads for one refusal code. */
export function emailRefusalMessage(code: EmailRefusal): string {
	return REFUSALS[code].message;
}

/**
 * The {@link ServiceResult} for one refusal code — its status and sentence, keyed to its form field
 * in `errors` where it has one (`email_invalid`, `password_incorrect`), and the code itself in
 * `details.refusal` (so a client can branch without parsing the sentence). `extra` adds facts such
 * as `retryAt`.
 */
export function emailRefusal(
	code: EmailRefusal,
	extra: FailureDetails = {},
): ServiceResult<never> {
	const { status, message } = REFUSALS[code];
	const field = REFUSAL_FIELD[code];
	const details = { ...extra, refusal: code };
	return field
		? fail(status, { message, errors: { [field]: message }, details })
		: fail(status, { message, details });
}

/** An RPC error as PostgREST returns it: `details` carries the exception's DETAIL. */
export interface RpcError {
	code?: string;
	message?: string;
	details?: string | null;
}

/** Read a refusal code off an RPC error, or `null` when the error is not one of ours. */
export function emailRefusalCode(error: RpcError | null | undefined): EmailRefusal | null {
	if (!error || error.code !== "P0001") return null;
	const parsed = EmailRefusal.safeParse(error.message?.trim());
	return parsed.success ? parsed.data : null;
}

/** `sign_in_limit`'s DETAIL is when the next move is allowed; anything else carries no time. */
function retryAtOf(code: EmailRefusal, error: RpcError): FailureDetails {
	if (code !== "sign_in_limit" || !error.details) return {};
	const at = Date.parse(error.details);
	return Number.isFinite(at) ? { retryAt: new Date(at).toISOString() } : {};
}

/**
 * Map an email-function error to a {@link ServiceResult} refusal. A refusal code becomes
 * {@link emailRefusal} (`sign_in_limit` with `details.retryAt`); `28000` and a stale
 * bearer are a lapsed session; `42501` is an account that has not finished onboarding; anything else
 * is reported as an outage, never as success.
 */
export function emailFailure(error: RpcError): ServiceResult<never> {
	const code = emailRefusalCode(error);
	if (code) return emailRefusal(code, retryAtOf(code, error));
	switch (error.code) {
		// No subject in the token (the definer's own check), or PostgREST refusing a stale bearer:
		// "JWT expired" (PGRST301), "no authorization" (PGRST302), "JWT invalid" (PGRST303).
		case "28000":
		case "PGRST301":
		case "PGRST302":
		case "PGRST303":
			return fail(401, { message: "Your session has expired. Please sign in again." });
		case "42501":
			return fail(403, { message: "Finish setting up your account before adding addresses." });
		default:
			return fail(503, { message: "We couldn't update your addresses. Try again in a moment." });
	}
}
// #endregion

// #region Verify outcomes
const OUTCOMES: Partial<Record<EmailRefusal, EmailVerifyOutcome>> = {
	token_invalid: "invalid",
	token_expired: "expired",
	token_used: "used",
	token_wrong_account: "wrong-account",
	email_in_use: "in-use",
};

/**
 * The `?email=` outcome a refused confirmation lands back on `/settings/account` with, or `null` when
 * the error is not a confirmation refusal (an outage, a lapsed session) — which has no outcome.
 */
export function verifyOutcomeFor(error: RpcError | null | undefined): EmailVerifyOutcome | null {
	const code = emailRefusalCode(error);
	return code ? OUTCOMES[code] ?? null : null;
}
// #endregion

// #region Rows
/** One row of `org.get_my_emails()`, as PostgREST returns it. */
export interface EmailRow {
	id: string;
	email: string;
	is_primary: boolean;
	verified_at: string | null;
	is_sign_in: boolean;
	/** Suppressed for email in every category (a hard bounce, COMMS NT3); absent on an older row. */
	undeliverable?: boolean;
	created_at: string;
}

/**
 * Map `org.get_my_emails()` rows onto {@link UserEmail}, keeping the definer's order (primary first).
 * A row that does not parse is dropped rather than half-rendered.
 */
export function toUserEmails(rows: readonly EmailRow[] | null | undefined): UserEmail[] {
	return (rows ?? []).flatMap((row) => {
		const parsed = UserEmailSchema.safeParse({
			id: row.id,
			email: row.email,
			isPrimary: row.is_primary,
			verifiedAt: row.verified_at,
			isSignIn: row.is_sign_in,
			undeliverable: row.undeliverable === true,
			createdAt: row.created_at,
		});
		return parsed.success ? [parsed.data] : [];
	});
}
// #endregion
