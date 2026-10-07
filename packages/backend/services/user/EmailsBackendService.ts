import type {
	AddUserEmail,
	EmailDeliveryOutcome,
	EmailVerificationIssued,
	EmailVerifyOutcome,
	UserEmail,
	UserEmailList,
} from "@projective/types/org";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { getServiceClient, getUserClient, isAuthBackendLive } from "../../core/supabase.ts";
import { serverEnv } from "../../core/env.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { canReadLive, type ReadActor } from "../read-actor.ts";
import { sendEmailVerification } from "../mail/verification-mailer.ts";
import {
	emailFailure,
	emailRefusal,
	type EmailRow,
	toUserEmails,
	verifyOutcomeFor,
} from "./emails-refusals.ts";

/**
 * EmailsBackendService — the FAT service behind the account settings' email addresses: list, add,
 * resend a confirmation, make primary, remove, and redeem a confirmation link.
 *
 * ## The trust model, in one paragraph
 *
 * `org.user_emails.verified_at` unlocks the invitations sent to an address, so no client role can
 * write the table (migration 00001050 and its policies/grants). Every call here goes through a
 * definer bound to the caller's OWN access token ({@link getUserClient} — RLS and `auth.uid()` see
 * the signed JWT), with ONE exception: minting a token, `security.issue_email_verification`, is the
 * service role's, because it returns the raw token. That call is handed only an address id the
 * caller's own token produced (`org.add_user_email`) or listed (`org.get_my_emails`) — never an id or
 * user id taken from the request — and the definer takes no identity at all: the token goes to the
 * row's own inbox and redeems only for the row's own account. The raw token leaves this process only
 * inside the mail; it is never in a {@link ServiceResult}.
 *
 * ## Environments
 *
 * Gated on `AUTH_BACKEND_LIVE` (the account domain's gate, as `UserBackendService` is): with no
 * database there is nothing truthful to answer, so every method refuses with a 503 rather than
 * inventing addresses. A guest is a 401.
 *
 * ## Sending is rate-limited
 *
 * Adding an address or resending its link mails somebody — possibly somebody who never asked. So both
 * share an in-process ceiling per person ({@link SEND_LIMIT}); the five-address cap bounds the rest.
 */

// #region Limits
/** Verification mails one person may trigger: five per fifteen minutes, adds and resends together. */
export const SEND_LIMIT = { max: 5, windowMs: 15 * 60_000 } as const;
const sends = new SlidingWindowLimiter(SEND_LIMIT);

/** The 429 a caller over {@link SEND_LIMIT} gets, with when they may try again. */
function rateLimited(retryAfterMs: number): ServiceResult<never> {
	return fail(429, {
		message: "You've asked for a lot of confirmation emails. Try again in a few minutes.",
		details: { retryAt: new Date(Date.now() + retryAfterMs).toISOString() },
	});
}
// #endregion

// #region Guards
/**
 * The caller's access token when they can run an RLS-scoped call, else the refusal: a guest is 401,
 * a database-less environment 503, a session with no token 401.
 */
function sessionToken(actor: ReadActor): string | ServiceResult<never> {
	if (!actor.userId) {
		return fail(401, { message: "Sign in to manage your email addresses." });
	}
	if (!isAuthBackendLive()) {
		return fail(503, { message: "Email addresses can't be managed in this environment." });
	}
	if (!canReadLive(actor)) {
		return fail(401, { message: "Your session has expired. Please sign in again." });
	}
	return actor.accessToken;
}

/** The outage every unexpected throw (network, misconfiguration) collapses to. */
function unreachable(): ServiceResult<never> {
	return fail(503, { message: "We couldn't reach the server. Try again in a moment." });
}

/** The answer to an id that is not one of the caller's addresses (or not an id at all). */
function notFound(): ServiceResult<never> {
	return emailRefusal("email_not_found");
}

/** A uuid. Ids are validated before they reach a definer, so junk is a 404, not a 503. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is shaped like an address id. */
export function isEmailId(value: string): boolean {
	return UUID.test(value);
}
// #endregion

/** The caller's list, or the refusal that stopped it. */
type EmailsRead = { emails: UserEmail[] } | { failure: ServiceResult<never> };

export class EmailsBackendService {
	// #region Reads
	/** The caller's addresses, primary first. */
	static async list(actor: ReadActor): Promise<ServiceResult<UserEmailList>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const read = await EmailsBackendService.fetchEmails(token);
			return "failure" in read ? read.failure : ok({ emails: read.emails });
		} catch {
			return unreachable();
		}
	}
	// #endregion

	// #region Add + resend
	/**
	 * File a new, UNVERIFIED address and mail its confirmation link. The address is saved even when
	 * the mail cannot go out — `delivery` says which (see `EmailDeliveryOutcome`), so the UI never
	 * claims an email was sent when it was not.
	 */
	static async add(
		actor: ReadActor,
		input: AddUserEmail,
	): Promise<ServiceResult<EmailVerificationIssued>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		const room = sends.peek(actor.userId);
		if (!room.allowed) return rateLimited(room.retryAfterMs);
		try {
			const { data, error } = await getUserClient(token)
				.schema("org")
				.rpc("add_user_email", { p_email: input.email });
			if (error) return emailFailure(error);
			if (typeof data !== "string" || !isEmailId(data)) return unreachable();

			const delivery = await EmailsBackendService.issueAndMail(actor.userId, data, input.email);
			const read = await EmailsBackendService.fetchEmails(token);
			if ("failure" in read) return read.failure;
			return ok({ emails: read.emails, delivery }, {
				status: 201,
				message: deliveryMessage(delivery, input.email),
			});
		} catch {
			return unreachable();
		}
	}

	/** Mail a fresh confirmation link for one of the caller's UNVERIFIED addresses. */
	static async resend(
		actor: ReadActor,
		emailId: string,
	): Promise<ServiceResult<EmailVerificationIssued>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		if (!isEmailId(emailId)) return notFound();
		try {
			const before = await EmailsBackendService.fetchEmails(token);
			if ("failure" in before) return before.failure;
			// Ownership is established by the caller's OWN token: an id that is not in their list is not
			// theirs, and is answered exactly like one that does not exist.
			const row = before.emails.find((email) => email.id === emailId);
			if (!row) return notFound();
			if (row.verifiedAt) return fail(409, { message: "That address is already confirmed." });
			const room = sends.peek(actor.userId);
			if (!room.allowed) return rateLimited(room.retryAfterMs);

			const delivery = await EmailsBackendService.issueAndMail(actor.userId, row.id, row.email);
			const read = await EmailsBackendService.fetchEmails(token);
			if ("failure" in read) return read.failure;
			return ok({ emails: read.emails, delivery }, {
				message: deliveryMessage(delivery, row.email),
			});
		} catch {
			return unreachable();
		}
	}
	// #endregion

	// #region Primary + remove
	/** Make one of the caller's CONFIRMED addresses their primary; answers the fresh list. */
	static async setPrimary(
		actor: ReadActor,
		emailId: string,
	): Promise<ServiceResult<UserEmailList>> {
		return await EmailsBackendService.mutate(actor, emailId, "set_primary_email", {
			message: "Your primary address is updated.",
		});
	}

	/** Remove one of the caller's secondary addresses; answers the fresh list. */
	static async remove(actor: ReadActor, emailId: string): Promise<ServiceResult<UserEmailList>> {
		return await EmailsBackendService.mutate(actor, emailId, "remove_user_email", {
			message: "The address is removed.",
		});
	}
	// #endregion

	// #region Confirm
	/**
	 * Redeem a confirmation token for the signed-in caller. Every refusal of the TOKEN is an outcome
	 * (`expired`, `invalid`, `used`, `wrong-account`, `in-use`) answered with `ok: true`, because the
	 * link did its job — it reached the person and the page says what happened. Only a lapsed session
	 * (401), an unfinished account (403) or an outage (503) fails.
	 */
	static async confirm(
		actor: ReadActor,
		confirmation: string,
	): Promise<ServiceResult<{ outcome: EmailVerifyOutcome }>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		try {
			const { error } = await getUserClient(token)
				.schema("org")
				.rpc("confirm_user_email", { p_token: confirmation });
			if (!error) return ok({ outcome: "verified" }, { message: "Your address is confirmed." });
			const outcome = verifyOutcomeFor(error);
			return outcome ? ok({ outcome }) : emailFailure(error);
		} catch {
			return unreachable();
		}
	}
	// #endregion

	// #region Internals
	/** `org.get_my_emails()` as the caller, mapped onto {@link UserEmail}. */
	private static async fetchEmails(accessToken: string): Promise<EmailsRead> {
		const { data, error } = await getUserClient(accessToken).schema("org").rpc("get_my_emails");
		if (error) return { failure: emailFailure(error) };
		return { emails: toUserEmails(data as EmailRow[] | null) };
	}

	/** Run a one-id write door as the caller, then answer the fresh list. */
	private static async mutate(
		actor: ReadActor,
		emailId: string,
		fn: "set_primary_email" | "remove_user_email",
		copy: { message: string },
	): Promise<ServiceResult<UserEmailList>> {
		const token = sessionToken(actor);
		if (typeof token !== "string") return token;
		if (!isEmailId(emailId)) return notFound();
		try {
			const { error } = await getUserClient(token).schema("org").rpc(fn, { p_email_id: emailId });
			if (error) return emailFailure(error);
			const read = await EmailsBackendService.fetchEmails(token);
			return "failure" in read
				? read.failure
				: ok({ emails: read.emails }, { message: copy.message });
		} catch {
			return unreachable();
		}
	}

	/**
	 * Mint a token for an address id the caller's own token produced, and mail it. Counts against
	 * {@link SEND_LIMIT}. Any failure to mint is `unavailable` — the address is already saved, and
	 * saying "check your inbox" would be the one wrong answer.
	 */
	private static async issueAndMail(
		userId: string,
		emailId: string,
		address: string,
	): Promise<EmailDeliveryOutcome> {
		sends.take(userId);
		let raw: string | null = null;
		try {
			const { data, error } = await getServiceClient()
				.schema("security")
				.rpc("issue_email_verification", { p_email_id: emailId });
			if (error) {
				console.warn(`[EmailsBackendService] could not issue a verification token: ${error.code}`);
				return "unavailable";
			}
			raw = typeof data === "string" && data.length > 0 ? data : null;
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			console.warn(`[EmailsBackendService] could not issue a verification token: ${reason}`);
			return "unavailable";
		}
		if (!raw) return "unavailable";
		return await sendEmailVerification({ to: address, token: raw, appUrl: serverEnv().appUrl });
	}
	// #endregion
}

/** The success sentence for an add or a resend, true to how the mail actually left. */
function deliveryMessage(delivery: EmailDeliveryOutcome, address: string): string {
	switch (delivery) {
		case "sent":
			return `We sent a confirmation link to ${address}.`;
		case "logged":
			return "Saved. No email service is connected here, so the confirmation link is in the server log.";
		case "unavailable":
			return "Saved, but we couldn't send the confirmation email. Try resending in a moment.";
	}
}
