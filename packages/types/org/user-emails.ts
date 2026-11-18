import { z } from "zod";
import { CaptchaTokenSchema } from "../auth/captcha.ts";

/**
 * org.user_emails — the Zod SSOT for a person's email addresses and the verification handshake that
 * proves they own one.
 *
 * ## Why verification is a token, never a column write
 *
 * `verified_at` is load-bearing: a verified address unlocks the project and workspace invitations
 * sent to it (`projects.project_invitations` SELECT, `org.fn_is_invitee`,
 * `projects.invite_by_email`). So a client role can never write it. Every write to `org.user_emails`
 * goes through a definer function: `org.add_user_email` files an UNVERIFIED address,
 * `security.issue_email_verification` (service role only) mints a single-use token whose SHA-256
 * alone is stored, the token travels by email to that address, and `org.confirm_user_email` — called
 * by the signed-in owner holding the token — is the one path that stamps `verified_at`. The token
 * never reaches a browser except through the inbox it proves.
 *
 * The migration, these schemas and `documentation/database/org/*` land together (root CLAUDE.md §1).
 */

// #region Rows
/** One address as the settings console lists it. */
export const UserEmailSchema = z.object({
	id: z.string(),
	email: z.string(),
	/** The contact address the platform writes to. Never the same thing as "can sign in with". */
	isPrimary: z.boolean(),
	/** ISO timestamp, or `null` while unverified. */
	verifiedAt: z.string().nullable(),
	/** The address GoTrue signs this account in with — it cannot be removed from here. */
	isSignIn: z.boolean(),
	createdAt: z.string(),
});
export type UserEmail = z.infer<typeof UserEmailSchema>;

/** `GET /api/user/emails` — the caller's addresses, primary first. */
export const UserEmailListSchema = z.object({
	emails: z.array(UserEmailSchema),
});
export type UserEmailList = z.infer<typeof UserEmailListSchema>;
// #endregion

// #region Writes
/** The longest address RFC 5321 lets a mailbox have. */
export const EMAIL_MAX_LENGTH = 254;

/**
 * `POST /api/user/emails` — file an unverified address. Deliberately loose (one `@`, a dotted
 * domain, no spaces): the only real validation of an address is the mail that has to arrive at it.
 */
export const AddUserEmailSchema = z.object({
	email: z.string().trim().toLowerCase().max(EMAIL_MAX_LENGTH).regex(
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/,
		"Enter an email address like name@example.com.",
	),
}).strict();
export type AddUserEmail = z.infer<typeof AddUserEmailSchema>;

/**
 * How the verification mail left: `sent` through the configured transport, `logged` to the server
 * console in development (no transport configured), or `unavailable` — the address is saved
 * unverified and nothing was sent. The UI says which, so "check your inbox" is never a lie.
 */
export const EmailDeliveryOutcome = z.enum(["sent", "logged", "unavailable"]);
export type EmailDeliveryOutcome = z.infer<typeof EmailDeliveryOutcome>;

/** The result of an add or a resend. */
export const EmailVerificationIssuedSchema = z.object({
	emails: z.array(UserEmailSchema),
	delivery: EmailDeliveryOutcome,
});
export type EmailVerificationIssued = z.infer<typeof EmailVerificationIssuedSchema>;

/** Hours a verification token stays valid. Mirrors `security.issue_email_verification`. */
export const EMAIL_TOKEN_TTL_HOURS = 24;

/**
 * The refusal codes the email definer functions raise (as the exception MESSAGE, SQLSTATE `P0001`),
 * so a service can map each to a sentence without parsing prose. `password_incorrect` is the one the
 * sign-in change answers itself, from GoTrue's password grant.
 */
export const EmailRefusal = z.enum([
	"email_invalid",
	"email_exists",
	"email_limit",
	"email_not_found",
	"email_unverified",
	"email_is_primary",
	"email_is_sign_in",
	"email_in_use",
	"token_invalid",
	"token_expired",
	"token_used",
	"token_wrong_account",
	"sign_in_already",
	"sign_in_unverified",
	"sign_in_limit",
	"sign_in_unavailable",
	"account_closing",
	"password_required",
	"password_incorrect",
]);
export type EmailRefusal = z.infer<typeof EmailRefusal>;

/** Addresses one account may hold — the definer refuses the next one with `email_limit`. */
export const MAX_USER_EMAILS = 5;

/** The `?email=` outcome the verify link lands back on `/settings/account` with. */
export const EmailVerifyOutcome = z.enum(["verified", "expired", "invalid", "used", "wrong-account", "in-use", "unavailable"]);
export type EmailVerifyOutcome = z.infer<typeof EmailVerifyOutcome>;

/**
 * The query parameter the mailed link carries its token to `/settings/account` in. The link's GET
 * (`/api/user/emails/verify`) spends nothing: it forwards the token here, and the person's press of
 * Confirm spends it with `POST /api/user/emails/verify` (PRD-C11, the #445 rule for mailed links).
 */
export const EMAIL_TOKEN_PARAM = "email-token";

/** `POST /api/user/emails/verify` — spend a confirmation token for the signed-in account. */
export const ConfirmUserEmailSchema = z.object({
	token: z.string().trim().min(1).max(256),
});
export type ConfirmUserEmail = z.infer<typeof ConfirmUserEmailSchema>;
// #endregion

// #region Sign-in change
/**
 * How often the sign-in address may move: two changes in any rolling three days. Mirrors
 * `org.prepare_sign_in_change`, which counts the `user.sign_in_changed` audit rows.
 */
export const SIGN_IN_CHANGE_LIMIT = { max: 2, windowDays: 3 } as const;

/** The longest password the re-authentication accepts before GoTrue is even asked. */
export const REAUTH_PASSWORD_MAX_LENGTH = 1024;

/**
 * `POST /api/user/emails/:id/sign-in` — sign in with one of the caller's CONFIRMED addresses from
 * now on. The current password re-authenticates the person (GoTrue's password grant, so the bot
 * check rides along as `captchaToken`); `makePrimary` also moves the contact address there.
 */
export const MakeSignInSchema = z.object({
	password: z.string().min(1, "Enter your password.").max(REAUTH_PASSWORD_MAX_LENGTH),
	captchaToken: CaptchaTokenSchema,
	makePrimary: z.boolean().default(false),
}).strict();
export type MakeSignIn = z.infer<typeof MakeSignInSchema>;

/** The result of a sign-in change: the fresh list, and how the notice to the old address left. */
export const SignInChangedSchema = z.object({
	emails: z.array(UserEmailSchema),
	notice: EmailDeliveryOutcome,
	/** `false` when the other sessions could not be ended; signing out ends them all. */
	otherSessionsEnded: z.boolean(),
});
export type SignInChanged = z.infer<typeof SignInChangedSchema>;
// #endregion
