import type {
	EmailDeliveryOutcome,
	MakeSignIn,
	SignInChanged,
	UserEmail,
} from "@projective/types/org";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { AUTH_THROTTLED_MESSAGE } from "../auth/auth-throttle.ts";
import { captchaRefused, isGoTrueCaptchaRefusal } from "../auth/captcha.ts";
import { emailRefusal } from "./emails-refusals.ts";

/**
 * sign-in-change — moving a person's sign-in address to one of their confirmed secondary addresses
 * (Decision #451), as an order of steps over injected {@link SignInChangePorts}, so the order and
 * every refusal are testable without GoTrue or a database. The live ports are
 * `sign-in-change-live.ts`; {@link EmailsBackendService.makeSignIn} wires them.
 *
 * The order is the security argument:
 *
 * 1. **List** the caller's addresses with their own token: the target must be theirs, and the old
 *    sign-in row is remembered for the record.
 * 2. **Prepare** (`org.prepare_sign_in_change`): confirmed, not already the sign-in, the account is
 *    not closing, it has a password, and the two-in-three-days limit. Nothing is written.
 * 3. **Re-authenticate**: the current password against the CURRENT sign-in address, through GoTrue's
 *    password grant. A live session alone never moves the address.
 * 4. **Move** `auth.users.email` (GoTrue admin API). A conflict with another account is one generic
 *    refusal that never says the address is taken. Step 2 catches it first; GoTrue reports a clash
 *    that slipped in between only as an opaque 500, so a failed move asks step 2 again to tell
 *    the two apart.
 * 5. **Record** (`org.record_sign_in_change`): the audit row, the in-app notice, the optional primary.
 * 6. **End the other sessions**, then **notify the old address** by mail.
 *
 * Steps 1–4 refuse cleanly with nothing changed. From step 5 on the move has happened, so a later
 * failure is reported in the result, never as a refusal of a change that did land.
 */

// #region Ports
/** What GoTrue's password grant said about the current password. */
export type PasswordCheck = "ok" | "incorrect" | "captcha" | "throttled" | "unavailable";

/** What GoTrue's admin update said. `conflict`: another account already signs in with it. */
export type SignInMove = "ok" | "conflict" | "unavailable";

/** What `org.prepare_sign_in_change` answers when the move may go ahead. */
export interface SignInPreparation {
	targetEmail: string;
	currentEmail: string;
}

/** The side effects one sign-in change needs. */
export interface SignInChangePorts {
	/** The caller's addresses, read with their own token. */
	list(): Promise<ServiceResult<UserEmail[]>>;
	prepare(emailId: string): Promise<ServiceResult<SignInPreparation>>;
	/** Check `password` for `email`, and revoke whatever session the check minted. */
	checkPassword(
		email: string,
		password: string,
		captchaToken: string | undefined,
	): Promise<PasswordCheck>;
	moveSignIn(email: string): Promise<SignInMove>;
	record(
		emailId: string,
		previousEmailId: string | null,
		makePrimary: boolean,
	): Promise<ServiceResult<null>>;
	/** Revoke every session but the caller's current one; `false` when that could not be done. */
	endOtherSessions(): Promise<boolean>;
	noticeOldAddress(oldAddress: string, newAddress: string): Promise<EmailDeliveryOutcome>;
	/** Where a landed move that could not be fully recorded is reported. Never an address. */
	report(line: string): void;
}
// #endregion

// #region GoTrue answers
/** A GoTrue error as auth-js surfaces it. */
export interface GoTrueError {
	status?: number;
	code?: string;
	message?: string;
}

/**
 * Read GoTrue's password-grant refusal. GoTrue checks the password BEFORE it checks that the address
 * is confirmed, so `email_not_confirmed` means the password was right.
 */
export function passwordCheckOf(error: GoTrueError): PasswordCheck {
	if (isGoTrueCaptchaRefusal(error)) return "captcha";
	if (error.code === "email_not_confirmed") return "ok";
	if (error.status === 429 || error.code?.startsWith("over_")) return "throttled";
	if (typeof error.status === "number" && error.status >= 400 && error.status < 500) {
		return "incorrect";
	}
	return "unavailable";
}

/**
 * Read GoTrue's admin-update refusal: another account already holds the address, or an outage.
 * GoTrue v2.197's admin update does not pre-check the address, so the clash arrives as the database's
 * own unique violation on `users_email_partial_key` (HTTP 500, code `23505`), not as `email_exists`.
 */
export function signInMoveOf(error: GoTrueError): SignInMove {
	if (error.code === "email_exists") return "conflict";
	if (error.code === "23505" && /users_email_partial_key/.test(error.message ?? "")) return "conflict";
	if (error.status === 422 && /already/i.test(error.message ?? "")) return "conflict";
	return "unavailable";
}
// #endregion

// #region Refusals
function unreachable(): ServiceResult<never> {
	return fail(503, { message: "We couldn't reach the server. Try again in a moment." });
}

function passwordRefusal(check: Exclude<PasswordCheck, "ok">): ServiceResult<never> {
	switch (check) {
		case "incorrect":
			return emailRefusal("password_incorrect");
		case "captcha":
			return captchaRefused();
		case "throttled":
			return fail(429, { message: AUTH_THROTTLED_MESSAGE });
		case "unavailable":
			return unreachable();
	}
}

/** The success sentence, true to what happened to the other sessions. */
export function signInChangedMessage(address: string, otherSessionsEnded: boolean): string {
	return otherSessionsEnded
		? `You now sign in with ${address}. Your other devices were signed out.`
		: `You now sign in with ${address}. We couldn't sign your other devices out, so sign out and back in to end every session.`;
}
// #endregion

// #region Run
/** Move the caller's sign-in to the address `emailId`, re-authenticated by `input.password`. */
export async function runSignInChange(
	ports: SignInChangePorts,
	emailId: string,
	input: MakeSignIn,
): Promise<ServiceResult<SignInChanged>> {
	const before = await ports.list();
	if (!before.ok || !before.data) return fail(before.status, before);
	if (!before.data.some((email) => email.id === emailId)) return emailRefusal("email_not_found");
	const previous = before.data.find((email) => email.isSignIn) ?? null;

	const prepared = await ports.prepare(emailId);
	if (!prepared.ok || !prepared.data) return fail(prepared.status, prepared);
	const { targetEmail, currentEmail } = prepared.data;

	const check = await ports.checkPassword(currentEmail, input.password, input.captchaToken);
	if (check !== "ok") return passwordRefusal(check);

	const moved = await ports.moveSignIn(targetEmail);
	if (moved === "conflict") return emailRefusal("sign_in_unavailable");
	if (moved === "unavailable") {
		const again = await ports.prepare(emailId);
		return again.details?.refusal === "sign_in_unavailable"
			? emailRefusal("sign_in_unavailable")
			: unreachable();
	}

	const recorded = await ports.record(emailId, previous?.id ?? null, input.makePrimary);
	if (!recorded.ok) {
		ports.report(
			`sign-in moved but not recorded (status ${recorded.status}, ${
				recorded.details?.refusal ?? "no refusal code"
			})`,
		);
	}
	const otherSessionsEnded = await ports.endOtherSessions();
	const notice = await ports.noticeOldAddress(currentEmail, targetEmail);

	const after = await ports.list();
	const emails = after.ok && after.data ? after.data : before.data;
	return ok(
		{ emails, notice, otherSessionsEnded },
		{ message: signInChangedMessage(targetEmail, otherSessionsEnded) },
	);
}
// #endregion
