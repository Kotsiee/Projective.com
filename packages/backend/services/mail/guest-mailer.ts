import { guestWhen } from "@projective/types/scheduling";
import type { MailMessage } from "./transport.ts";

/**
 * guest-mailer — what reaches somebody with no account (Decision #391).
 *
 * The wording is fixed. The only text a host wrote is the entry's title and their own name, both
 * through `scheduling.fn_guest_safe_text` before they reach here, because this leaves under
 * Projective's name for an inbox that never asked for it. Each message a host caused carries its own
 * link and says how to stop them. A withdrawal's link is dead, and works for that alone. A code is only
 * ever sent because somebody on the page asked for it.
 */

/** A row of `scheduling.claim_guest_mail`. */
export interface GuestMailRow {
	mail_id: string;
	kind: "invite" | "moved" | "withdrawn";
	email: string;
	token: string;
	title: string;
	starts_at: string;
	ends_at: string;
	all_day: boolean;
	timezone: string | null;
	host_name: string | null;
}

/** The page a guest's link opens. */
export function guestLink(appUrl: string, token: string): string {
	return `${appUrl.replace(/\/+$/, "")}/rsvp/${encodeURIComponent(token)}`;
}

const STOP =
	"You got this because this address was added to an event on Projective. To stop these emails, open the link above and choose Stop these emails.";

/** The message a queued row stands for. */
export function guestMessage(row: GuestMailRow, appUrl: string): MailMessage {
	const host = row.host_name ?? "Someone";
	const when = guestWhen({
		start: Date.parse(row.starts_at),
		end: Date.parse(row.ends_at),
		allDay: row.all_day,
		timezone: row.timezone,
	});
	const link = guestLink(appUrl, row.token);

	if (row.kind === "withdrawn") {
		return {
			to: row.email,
			subject: `Cancelled: ${row.title}`,
			text: [
				`${host} withdrew your invitation to ${row.title}, which was set for ${when}.`,
				"",
				"There's nothing you need to do.",
				"",
				"To stop these emails, open this link and choose Stop these emails:",
				link,
			].join("\n"),
		};
	}
	if (row.kind === "moved") {
		return {
			to: row.email,
			subject: `New time: ${row.title}`,
			text: [
				`${host} moved ${row.title}.`,
				"",
				`New time: ${when}`,
				"",
				"Can you still make it? Answer here:",
				link,
				"",
				STOP,
			].join("\n"),
		};
	}
	return {
		to: row.email,
		subject: `Invitation: ${row.title}`,
		text: [
			`${host} invited you to ${row.title}.`,
			"",
			`When: ${when}`,
			"",
			"See the details and answer here. You don't need an account:",
			link,
			"",
			"This link is yours, so please don't forward it. Joining the call takes a code sent to this address.",
			"",
			STOP,
		].join("\n"),
	};
}

/** The code that lets a guest into a call. */
export function guestCodeMessage(to: string, title: string, code: string): MailMessage {
	return {
		to,
		subject: `Your code for ${title}`,
		text: [
			`Your code to join ${title} is ${code}.`,
			"",
			"It works until the meeting ends. Don't share it: anyone with this code and your link can join as you.",
			"",
			"If you didn't ask for this, you can ignore this email.",
		].join("\n"),
	};
}
