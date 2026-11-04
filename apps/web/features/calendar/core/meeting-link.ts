import { MeetingProvider } from "@projective/types/scheduling";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * meeting-link — which conferencing provider a pasted join link belongs to.
 *
 * The LINK decides the provider, never the other way round: a host who picked Zoom and then pasted
 * a Meet link has a Meet room, and a rail that kept saying Zoom would send every joiner to the wrong
 * app. A host is matched only on its exact registrable domain or a subdomain of it, so
 * `zoom.us.example.com` is a custom link rather than a Zoom room.
 */

// #region Trusted hosts
const TRUSTED_HOSTS: { provider: MeetingProvider; domains: readonly string[] }[] = [
	{ provider: "google", domains: ["meet.google.com"] },
	{ provider: "zoom", domains: ["zoom.us", "zoom.com", "zoomgov.com"] },
	{ provider: "microsoft_teams", domains: ["teams.microsoft.com", "teams.live.com"] },
];
// #endregion

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
	const host = url.hostname.toLowerCase();
	const match = TRUSTED_HOSTS.find((t) =>
		t.domains.some((d) => host === d || host.endsWith(`.${d}`))
	);
	return { ok: true, provider: match?.provider ?? "custom" };
}
