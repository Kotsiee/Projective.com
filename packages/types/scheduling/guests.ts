import { z } from "zod";
import { RsvpResponse } from "./coordination.ts";
import { RoomJoinState } from "./rooms.ts";

/**
 * guests — somebody on an entry with no Projective account (Decision #391).
 *
 * A guest is an `EventAttendee` seat held by an address. They have no session, so they hear by email
 * and act through a link unique to each message, on a page with no shell at `/rsvp/:token`. The link
 * alone shows the invitation and answers it. Joining a call also takes a code sent to the invited
 * address, so a forwarded link gets nobody in.
 *
 * Only a host's own personal entry takes one. A paid sitting, a booking, an engagement's meeting and a
 * discovery call are Projective-only, because `scheduling.fn_invitable_event` refuses them.
 */

// #region Limits
/**
 * The most addresses one person may ask in a day. An invitation by email reaches a stranger's inbox
 * under Projective's name, on the domain that also sends sign-up confirmations.
 * `scheduling.invite_to_event` holds the same figure, and `coordination.contract.test.ts` pins the two.
 */
export const GUEST_INVITES_DAILY_MAX = 50;

/**
 * The most invitations and new times one address gets in a day, whoever sends them, so that nobody can
 * fill an inbox by moving an entry or by using several accounts. Past it a new time waits a day and
 * says the latest time when it goes. Pinned the same way.
 */
export const GUEST_ADDRESS_MAILS_DAILY_MAX = 10;
// #endregion

// #region What a link says
/** The capability in a guest's link: 32 random bytes as hex. Checked before any read. */
export const GuestTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** The code that proves a guest reads the invited inbox. */
export const GuestCodeSchema = z.string().trim().regex(/^[0-9]{6}$/);

/** The three answers a link can give. `pending` is the absence of one. */
export const GuestAnswer = z.enum(["accepted", "tentative", "rejected"]);
export type GuestAnswer = z.infer<typeof GuestAnswer>;

/** Where a guest stands with an entry's room. A link only works while its entry is live. */
export const GuestRoomState = RoomJoinState.extract([
	"open",
	"upcoming",
	"needs_rsvp",
	"not_party",
	"no_room",
]);
export type GuestRoomState = z.infer<typeof GuestRoomState>;

/** What `scheduling.guest_invitation` says of a live link. Times are epoch ms (UTC). */
const LiveInvitationSchema = z.object({
	state: z.literal("live"),
	title: z.string(),
	host: z.string().nullable(),
	starts_at: z.string(),
	ends_at: z.string(),
	all_day: z.boolean(),
	timezone: z.string().nullable(),
	response: RsvpResponse,
	location: z.string().nullable(),
	room_state: GuestRoomState.nullable(),
	opens_at: z.string(),
	code_sent: z.boolean(),
	address_hint: z.string(),
}).transform((row) => ({
	state: row.state,
	title: row.title,
	host: row.host,
	start: Date.parse(row.starts_at),
	end: Date.parse(row.ends_at),
	allDay: row.all_day,
	timezone: row.timezone,
	response: row.response,
	location: row.location,
	roomState: row.room_state,
	opensAt: Date.parse(row.opens_at),
	codeSent: row.code_sent,
	addressHint: row.address_hint,
}));

/** A link is live or dead, and a dead link says nothing about why. */
export const GuestInvitationSchema = z.union([
	z.object({ state: z.literal("dead") }),
	LiveInvitationSchema,
]);
export type GuestInvitation = z.infer<typeof GuestInvitationSchema>;

/** A live invitation, with the time fields both surfaces need. */
export type LiveGuestInvitation = Extract<GuestInvitation, { state: "live" }>;
// #endregion

// #region Wording
/**
 * A zone `Intl` can format in. Postgres knows names ICU does not (`posix/…`), and an email that could not
 * say when must not stop the sweep, so one of those reads as UTC, which `guestWhen` then states.
 */
export function knownZone(zone: string | null): string {
	if (!zone) return "UTC";
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: zone });
		return zone;
	} catch {
		return "UTC";
	}
}

/** When an entry is, in its host's zone: a guest has no zone on file, so the page and the email name it. */
export function guestWhen(
	when: { start: number; end: number; allDay: boolean; timezone: string | null },
): string {
	const timeZone = knownZone(when.timezone);
	const day = new Intl.DateTimeFormat("en-GB", {
		weekday: "short",
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone,
	});
	if (when.allDay) return day.format(when.start);
	const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
	const [from, to] = [day.format(when.start), day.format(when.end)];
	return from === to
		? `${from}, ${time.format(when.start)} to ${time.format(when.end)} (${timeZone})`
		: `${from}, ${time.format(when.start)} to ${to}, ${time.format(when.end)} (${timeZone})`;
}

/** Why a guest's code did not open a room, in the words the page says it. */
export const GUEST_JOIN_REFUSAL: Readonly<Record<string, string>> = {
	no_code: "Ask for a code first.",
	wrong_code: "That code isn't right. Check your email and try again.",
	locked: "That's too many wrong tries. Ask for a new code.",
	dead: "This invitation is no longer active.",
};

/** What each answer says back to the guest who gave it. */
export const GUEST_ANSWER_SAID: Record<GuestAnswer, string> = {
	accepted: "You're going",
	tentative: "You said maybe",
	rejected: "You said you can't make it",
};
// #endregion
