import type { EmailDeliveryOutcome } from "@projective/types/org";
import { deliverMail, type MailerDeps, type MailMessage } from "./transport.ts";

/**
 * sign-in-change-mailer — the security notice mailed to the OLD address when an account's sign-in
 * address moves (Decision #451). GoTrue sends no mail for an admin email update, so this is the only
 * word the old inbox gets. How it leaves, and what the caller is told, is `./transport.ts`.
 *
 * It names the new address masked: the old inbox learns which address took over, enough to recognise
 * it, without a full second address travelling to an inbox the person may no longer control.
 */

// #region Message
/** `jane.doe@example.com` → `j•••@example.com`; anything without an `@` is masked whole. */
export function maskAddress(address: string): string {
	const at = address.lastIndexOf("@");
	if (at <= 0) return "•••";
	return `${address[0]}•••${address.slice(at)}`;
}

/** The notice for the address that no longer signs the account in. */
export function signInChangedMessage(to: string, newAddress: string, appUrl: string): MailMessage {
	const base = appUrl.replace(/\/+$/, "");
	return {
		to,
		subject: "Your Projective sign-in address was changed",
		text: [
			`The address you sign in to Projective with was just changed from ${to} to ${
				maskAddress(newAddress)
			}. Your other devices were signed out.`,
			"",
			"If you made this change, there is nothing to do. This address stays on your account as a confirmed address until you remove it.",
			"",
			`If you didn't, contact us straight away so we can secure the account: ${base}/contact`,
		].join("\n"),
	};
}
// #endregion

// #region Send
/** Mail the sign-in change notice to the old address, and say how it left. Never throws. */
export function sendSignInChangedNotice(
	mail: { to: string; newAddress: string; appUrl: string },
	deps: Partial<MailerDeps> = {},
): Promise<EmailDeliveryOutcome> {
	return deliverMail(
		signInChangedMessage(mail.to, mail.newAddress, mail.appUrl),
		"sign-in change notice",
		`[dev mail] Sign-in changed: notice to ${mail.to} (now ${maskAddress(mail.newAddress)})`,
		deps,
	);
}
// #endregion
