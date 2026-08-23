import { z } from "zod";

/**
 * The CONFERENCING axis — which tool mints the room an event happens in, and how a joiner gets in.
 *
 * This file exists so the axis has a physical home of its own. Root CLAUDE.md §8 Decision #56
 * established that **calendar sync and conferencing are two capability axes and must never be one
 * chip set**: a connected Google Calendar tells you when someone is busy; a Google Meet grant lets
 * the platform mint a room. A user may hold either without the other, which is why
 * `integrations.providers.capabilities` is a multi-valued `provider_kind[]` and why
 * {@link CONFERENCING_PROVIDERS} lives here rather than beside `INTEGRATION_SOURCES` (the
 * calendar-sync chip vocabulary, which stays in `./scheduling.ts` with the page projections).
 *
 * Google and Outlook appear on both axes because those vendors are genuinely capable of both, not
 * because the axes are the same.
 */

// #region Provider vocabulary
/**
 * The providers capable of MINTING A MEETING ROOM (`capabilities @> {conferencing}`). The full
 * catalogue is DATA (`integrations.providers`); this is the subset the scheduling domain names, and
 * its shapes live in `@projective/types/integrations`.
 */
export const CONFERENCING_PROVIDERS = [
	"google",
	"outlook",
	"zoom",
	"microsoft_teams",
	"discord",
] as const;
export type ConferencingProvider = (typeof CONFERENCING_PROVIDERS)[number];

/** Human labels for the conferencing providers. */
export const CONFERENCING_LABEL: Record<ConferencingProvider, string> = {
	google: "Google Meet",
	outlook: "Outlook",
	zoom: "Zoom",
	microsoft_teams: "Microsoft Teams",
	discord: "Discord",
};

/**
 * What an event's room was made with: a connected conferencing provider, or `custom` — a link the
 * host pasted in themselves (a physical address, a self-hosted Jitsi, a phone bridge).
 *
 * `custom` is a first-class member rather than a null provider because "the host supplied their own
 * link" and "no room yet" are different facts: the first is a finished arrangement the joiner can
 * act on, the second is an outstanding task. {@link EventMeetingSchema.pending} carries the second.
 */
export const MeetingProvider = z.enum([
	"google",
	"outlook",
	"zoom",
	"microsoft_teams",
	"discord",
	"custom",
]);
export type MeetingProvider = z.infer<typeof MeetingProvider>;

/**
 * Compile-time proof that every room-minting provider is expressible as a {@link MeetingProvider}.
 * Two vocabularies for one axis is the drift this file exists to prevent, so the guard is a type
 * error rather than a convention: adding a member to {@link CONFERENCING_PROVIDERS} without adding
 * it to {@link MeetingProvider} stops compiling here.
 */
type ConferencingIsMeetable = ConferencingProvider extends MeetingProvider ? true : false;
const _conferencingIsMeetable: ConferencingIsMeetable = true;

/** Human labels for every meeting provider, including the host's own arrangement. */
export const MEETING_PROVIDER_LABEL: Record<MeetingProvider, string> = {
	...CONFERENCING_LABEL,
	custom: "Custom link",
};
// #endregion

// #region The room
/**
 * Where an event actually happens online.
 *
 * `joinUrl` is present ONLY to the event's own parties — the server withholds it from everyone else
 * rather than relying on the URL being unguessable, because a meeting link IS the access control for
 * most providers. A masked/privacy-projected block therefore carries no meeting at all.
 */
export const EventMeetingSchema = z.object({
	provider: MeetingProvider,
	/**
	 * The label to render. {@link MEETING_PROVIDER_LABEL} for a known provider; for `custom` the host
	 * names it themselves ("Studio, 2nd floor", "Dial-in bridge"), which is why this is carried
	 * rather than derived at the render site.
	 */
	providerLabel: z.string().max(60),
	/** The room. `null` when the viewer may not have it, or when it has not been minted yet. */
	joinUrl: z.string().max(600).nullable(),
	/** A passcode / PIN / meeting id — free text, because every provider words this differently. */
	passcode: z.string().max(120).nullable(),
	/** Anything else a joiner needs: dial-in numbers, a room number, "ask for reception". */
	details: z.string().max(600).nullable(),
	/**
	 * True while the room is still to be created. A courtesy call mints its link on confirmation
	 * (`scheduling.call_audit` action `link_generated`), so between request and confirmation there is
	 * a provider and an intent but no URL — which reads very differently from "you cannot see it".
	 */
	pending: z.boolean().default(false),
});
export type EventMeeting = z.infer<typeof EventMeetingSchema>;
// #endregion
