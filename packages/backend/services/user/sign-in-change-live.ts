import { getAnonClient, getServiceClient, getUserClient } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { fail, ok } from "../ServiceResult.ts";
import { sendSignInChangedNotice } from "../mail/sign-in-change-mailer.ts";
import { emailFailure, type EmailRow, toUserEmails } from "./emails-refusals.ts";
import { passwordCheckOf, type SignInChangePorts, signInMoveOf } from "./sign-in-change.ts";

/** One row of `org.prepare_sign_in_change()`, as PostgREST returns it. */
interface PreparationRow {
	target_email?: unknown;
	current_email?: unknown;
}

/**
 * The live {@link SignInChangePorts} for one signed-in caller (Decision #451).
 *
 * Every database step runs as the caller's OWN token ({@link getUserClient}). The service role
 * makes exactly three GoTrue admin calls, each safe for its own reason:
 *
 * - `updateUserById(userId, { email, email_confirm: true })` moves the sign-in address, the
 *   precedent being `AuthBackendService`'s admin calls before a session exists. `userId` is the
 *   verified session's subject, never request input. The address is the caller's own CONFIRMED row,
 *   exactly as `org.prepare_sign_in_change` returned it under that same token. It runs only after
 *   the current password checked out. `email_confirm` because the app's single-use token already
 *   proved the inbox: GoTrue's double-confirm would be a second verification system, and GoTrue
 *   sends no mail for an admin update.
 * - `signOut(grantToken, "local")` revokes only the session the password check itself minted.
 * - `signOut(accessToken, "others")` takes the caller's own token: GoTrue revokes every OTHER
 *   session of that subject and keeps the one making the change.
 *
 * The password is checked by GoTrue's own password grant (the bot-check token passed through), so
 * GoTrue stays the only thing that ever compares a password.
 */
export function liveSignInPorts(userId: string, accessToken: string): SignInChangePorts {
	const asCaller = () => getUserClient(accessToken).schema("org");

	async function revoke(grantToken: string): Promise<void> {
		const { error } = await getServiceClient().auth.admin.signOut(grantToken, "local");
		if (error) console.warn(`[EmailsBackendService] re-auth session not revoked: ${error.status}`);
	}

	return {
		async list() {
			const { data, error } = await asCaller().rpc("get_my_emails");
			return error ? emailFailure(error) : ok(toUserEmails(data as EmailRow[] | null));
		},

		async prepare(emailId) {
			const { data, error } = await asCaller().rpc("prepare_sign_in_change", {
				p_email_id: emailId,
			});
			if (error) return emailFailure(error);
			const row = (Array.isArray(data) ? data[0] : data) as PreparationRow | null | undefined;
			if (typeof row?.target_email !== "string" || typeof row.current_email !== "string") {
				return fail(503, { message: "We couldn't reach the server. Try again in a moment." });
			}
			return ok({ targetEmail: row.target_email, currentEmail: row.current_email });
		},

		async checkPassword(email, password, captchaToken) {
			const { data, error } = await getAnonClient().auth.signInWithPassword({
				email,
				password,
				options: { captchaToken },
			});
			if (data.session) await revoke(data.session.access_token);
			if (error) return passwordCheckOf(error);
			return data.user?.id === userId ? "ok" : "incorrect";
		},

		async moveSignIn(email) {
			const { data, error } = await getServiceClient().auth.admin.updateUserById(userId, {
				email,
				email_confirm: true,
			});
			if (error) return signInMoveOf(error);
			return data.user?.email?.toLowerCase() === email.toLowerCase() ? "ok" : "unavailable";
		},

		async record(emailId, previousEmailId, makePrimary) {
			const { error } = await asCaller().rpc("record_sign_in_change", {
				p_email_id: emailId,
				p_previous_email_id: previousEmailId,
				p_make_primary: makePrimary,
			});
			return error ? emailFailure(error) : ok(null);
		},

		async endOtherSessions() {
			const { error } = await getServiceClient().auth.admin.signOut(accessToken, "others");
			return !error;
		},

		noticeOldAddress(oldAddress, newAddress) {
			return sendSignInChangedNotice({ to: oldAddress, newAddress, appUrl: serverEnv().appUrl });
		},

		report(line) {
			console.error(`[EmailsBackendService] ${line} for user ${userId}`);
		},
	};
}
