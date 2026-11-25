import { invitationRolePhrase, inviteLinkPath } from "@projective/types/projects";
import type { MailMessage } from "./transport.ts";

/**
 * invitation-mailer — the one email an email invitation sends to an address no verified account holds
 * (PROJECTS NO1).
 *
 * The wording is fixed. The only text an inviter wrote is the project's title, the stage's name and
 * their own name, each through `scheduling.fn_guest_safe_text` in `projects.claim_invitation_mail`
 * before it reaches here, because this leaves under Projective's name for an inbox that never asked
 * for it. One message per invitation, never a reminder: it says so, and says ignoring it is safe.
 */

/** A row of `projects.claim_invitation_mail`. */
export interface InvitationMailRow {
	mail_id: string;
	email: string;
	token: string;
	project_title: string;
	stage_name: string | null;
	inviter_name: string | null;
	role: string;
	expires_at: string | null;
}

/** The page an invitation's link opens: `/invite/{token}` on the app's origin. */
export function invitationLink(appUrl: string, token: string): string {
	return `${appUrl.replace(/\/+$/, "")}${inviteLinkPath(encodeURIComponent(token))}`;
}

/** `9 December 2026`, read in UTC so the date does not move with the server's zone. */
function expiryDate(iso: string): string | null {
	const at = Date.parse(iso);
	if (Number.isNaN(at)) return null;
	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(at);
}

/** The message a claimed row stands for. */
export function invitationMessage(row: InvitationMailRow, appUrl: string): MailMessage {
	const inviter = row.inviter_name ?? "Someone";
	const where = row.stage_name ? `${row.project_title} · ${row.stage_name}` : row.project_title;
	const expires = row.expires_at ? expiryDate(row.expires_at) : null;
	const role = invitationRolePhrase(row.role);

	return {
		to: row.email,
		subject: `${inviter} invited you to ${row.stage_name ?? row.project_title} on Projective`,
		text: [
			`${inviter} invited you to join ${where} on Projective, as ${role}.`,
			"",
			"Open the invitation:",
			invitationLink(appUrl, row.token),
			"",
			`It opens for an account that holds this address: sign up with ${row.email}, or sign in if you already have an account with it.`,
			...(expires ? [`The invitation expires on ${expires}.`] : []),
			"",
			"If you weren't expecting this, you can ignore it. Nothing happens unless you open the link, and this is the only email about this invitation.",
		].join("\n"),
	};
}
