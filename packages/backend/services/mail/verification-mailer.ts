import type { EmailDeliveryOutcome } from "@projective/types/org";
import { deliverMail, type MailerDeps, type MailMessage } from "./transport.ts";

/**
 * verification-mailer — the message an email-verification link leaves the server in. How it leaves,
 * and what the caller is told, is `./transport.ts`.
 *
 * The raw token exists in exactly two places: this call and the message it builds. It is never
 * returned to a caller of the service, never put in a response body, and never logged in production.
 */

// #region Link + message
/** The route that redeems a token: `GET /api/user/emails/verify?token=…`. */
export const VERIFY_PATH = "/api/user/emails/verify";

/** Build the absolute verification link for a token on the given app origin. */
export function verificationLink(appUrl: string, token: string): string {
	const base = appUrl.replace(/\/+$/, "");
	return `${base}${VERIFY_PATH}?token=${encodeURIComponent(token)}`;
}

/** The verification message for one address. */
export function verificationMessage(to: string, link: string): MailMessage {
	return {
		to,
		subject: "Confirm your email address for Projective",
		text: [
			"Someone — hopefully you — added this address to a Projective account.",
			"",
			"Open this link while signed in to that account to confirm it. It works once and expires in 24 hours:",
			link,
			"",
			"If this wasn't you, ignore this email. Nothing changes until the link is opened.",
		].join("\n"),
	};
}
// #endregion

// #region Send
/** Mail a verification link for `token` to `to`, and say how it left. Never throws. */
export function sendEmailVerification(
	mail: { to: string; token: string; appUrl: string },
	deps: Partial<MailerDeps> = {},
): Promise<EmailDeliveryOutcome> {
	const link = verificationLink(mail.appUrl, mail.token);
	return deliverMail(
		verificationMessage(mail.to, link),
		"verification email",
		`[dev mail] Verify ${mail.to} -> ${link}`,
		deps,
	);
}
// #endregion
