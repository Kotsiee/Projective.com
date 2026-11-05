import {
	type CalendarEvent,
	type EntryRoom,
	type EventMeeting,
	isRoomAddress,
	MEETING_PROVIDER_LABEL,
	MeetingProvider,
	meetingProviderOf,
} from "@projective/types/scheduling";
import type { ConnectionsView } from "@projective/types/integrations";
import { normalizeLink } from "@projective/types/links";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * meeting-link — which conferencing provider a pasted join link belongs to.
 *
 * The LINK decides the provider, never the other way round: a host who picked Zoom and then pasted
 * a Meet link has a Meet room, and a rail that kept saying Zoom would send every joiner to the wrong
 * app.
 */

// #region Generated rooms
/**
 * The providers whose room is CREATED for the host through their integration rather than pasted:
 * the composer shows no link field for them, and the room stays `pending` until it exists.
 */
export const GENERATED_PROVIDERS: readonly MeetingProvider[] = [
	"google",
	"zoom",
	"microsoft_teams",
];

/** The provider a new entry's room starts on: the host's last pick, else Google Meet. */
export function rememberedProvider(): MeetingProvider {
	const parsed = MeetingProvider.safeParse(
		readStored("local", LocalKeys.CALENDAR_MEETING_PROVIDER),
	);
	return parsed.success ? parsed.data : "google";
}

/** Remember a host's pick for the next entry they compose. */
export function rememberProvider(provider: MeetingProvider): void {
	writeStored("local", LocalKeys.CALENDAR_MEETING_PROVIDER, provider);
}

/**
 * Whether the viewer holds an account a room can be made on, as `scheduling.fn_room_connection` will
 * judge it. A Teams room is made through the Microsoft connection.
 */
export function canMintOn(provider: MeetingProvider, view: ConnectionsView): boolean {
	const slug = provider === "microsoft_teams" ? "outlook" : provider;
	return view.connections.some((c) =>
		c.providerSlug === slug && c.status === "active" && c.grantedKinds.includes("conferencing")
	);
}

/** The kinds that are a moment or a held span rather than a gathering, and so have no room. */
export const ROOMLESS: ReadonlySet<CalendarEvent["kind"]> = new Set([
	"general",
	"deadline",
	"busy",
]);

/**
 * The room as it stands, so a patch never has to invent the half it is not changing. A new entry's
 * room starts on the provider its host picked last (Google Meet the first time).
 */
export function meetingOf(event: CalendarEvent): EventMeeting {
	if (event.meeting) return event.meeting;
	const provider = rememberedProvider();
	return {
		provider,
		providerLabel: MEETING_PROVIDER_LABEL[provider],
		joinUrl: null,
		passcode: null,
		details: null,
		pending: true,
	};
}

/**
 * What saving an entry from the modal says about its room: what the modal showed, so the pick its
 * host saw is the pick that is saved. The server decides whether it can be minted.
 */
export function roomOf(event: CalendarEvent): EntryRoom | null {
	if (ROOMLESS.has(event.kind)) return null;
	const { provider, joinUrl, passcode } = meetingOf(event);
	const pasted = joinUrl && !isRoomAddress(joinUrl) ? normalizeLink(joinUrl) : null;
	return { provider, link: pasted?.startsWith("https://") ? pasted : null, passcode };
}
// #endregion

/** The outcome of {@link checkJoinLink}. */
export type JoinLinkCheck =
	| { ok: true; provider: MeetingProvider }
	| { ok: false; message: string };

/** Validate a join link and name the provider its host belongs to (`custom` for any other https host). */
export function checkJoinLink(raw: string): JoinLinkCheck {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, message: "That is not a web address — paste the full https:// link." };
	}
	if (url.protocol !== "https:") {
		return { ok: false, message: "Join links must start with https://." };
	}
	return { ok: true, provider: meetingProviderOf(url) };
}
