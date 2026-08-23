import type { CalendarEvent } from "./scheduling.ts";

/**
 * VIEWER PRIVACY — what a given caller is allowed to receive of an event's coordination payload.
 *
 * `./coordination.ts` answers "may this happen"; this file answers "may this person see it". They
 * are deliberately separate files because conflating them is the exact defect this module exists to
 * close: the projection used to be gated on {@link CalendarEvent.masked}, a PRESENTATION flag that
 * says "render the status label instead of the title". A public group session is legitimately
 * unmasked — it advertises its title and its seat count — and gating on that flag therefore served
 * an anonymous visitor the roster, the meeting link, the passcode, the attendees' personal notes and
 * the host's earnings along with it.
 *
 * **Masking and withholding are two different rules and both apply.** Masking hides WHAT a block is
 * from everyone (§Part 1.4). Withholding hides an event's PARTIES, ROOM, MONEY and NEGOTIATION from
 * anyone who is not one of its parties. An unmasked public session is fully subject to the second.
 *
 * **It is an allow-list, not a deny-list** ({@link PUBLIC_EVENT_FIELDS}). A field added to
 * {@link CalendarEvent} tomorrow is withheld from strangers until somebody deliberately publishes
 * it: the failure mode of forgetting is then a missing label, which is visible and gets fixed, and
 * not a leak, which is invisible and does not.
 *
 * **Applied at the service boundary, on the way out, unconditionally.** Not in a fixture, not in a
 * route, not in a component — one choke point every read passes through, so no future surface can
 * be the one that forgets.
 */

// #region The viewer
/**
 * Who is asking. Resolved from the request's own session by the layer that has one, never from the
 * payload.
 *
 * **Deliberately NOT a Zod schema.** Every sibling write shape in this domain is parseable because
 * it comes from the client; this one must never be, because a caller who could supply their own
 * `{ authenticated: true }` would be supplying their own authorisation. The absence of a parser is
 * the safeguard — there is nothing here for a route to hand a request body to.
 */
export interface SchedulingViewer {
	/**
	 * Whether a session was present on the request. A skeleton presence check (root CLAUDE.md §8
	 * Decision #14), which is why it gates only what is SHOWN: RLS remains the real gate once the
	 * live path lands, and nothing here grants access to anything.
	 */
	authenticated: boolean;
	/** The viewer's `@handle`, bare (no leading `@`), when one is known. `null` for a guest. */
	handle: string | null;
}

/**
 * The default viewer: nobody. Every entry point defaults to this, so a caller that forgets to pass a
 * viewer gets LESS data rather than more — the only direction a mistake here is allowed to fail.
 */
export const ANONYMOUS_VIEWER: SchedulingViewer = { authenticated: false, handle: null };
// #endregion

// #region The rule
/**
 * Is this viewer a party to this event — its host, or somebody on its roster?
 *
 * The test reads the seating the SERVER performed (`viewerIsHost`, and the roster row it marked
 * `isViewer`) rather than comparing handles here, because a handle comparison cannot see a
 * team-owned engagement where the acting seat is an organisation's, and because the client must
 * never be the one deciding. Resolving identity and applying privacy stay two steps: the reader
 * seats whoever is asking, this predicate reads the seating.
 *
 * A guest is never a party, whatever a payload claims.
 */
export function isEventParty(event: CalendarEvent, viewer: SchedulingViewer): boolean {
	if (!viewer.authenticated) return false;
	if (event.viewerIsHost === true) return true;
	return (event.roster ?? []).some((a) => a.isViewer);
}

/**
 * The fields a NON-party receives: where the block sits, what the privacy-safe label says, and — for
 * a public group session — how many people are coming and how many seats there are.
 *
 * `attendees`/`capacity` are counts, and a count is the whole point of the §Part 1.4 exception: a
 * public schedule may say "8 going" precisely because it names nobody. `bookable`/`callType`/
 * `feeAmountMinor`/`feeCurrency` are a public OFFER — what it would cost a stranger to book — which
 * is a different fact from {@link CalendarEvent.pricing}, the host's earnings from the people who
 * already have.
 *
 * Everything absent from this list is withheld, notably: `roster` (identities, RSVP answers and the
 * personal notes people left with them), `organiser`, `viewerIsHost`, `meeting` (the join URL, the
 * passcode and the dial-in details — a meeting link IS the access control for most providers, so
 * publishing one is publishing entry), `pricing` (the host's per-occurrence and per-series
 * earnings), `reschedule` (proposed times, and who voted for what), `history` (the whole audit log,
 * actors included), `attachments` (the agenda pack — every one carries a resolvable asset URL),
 * `description` (the agenda itself: a public session advertises WHAT it is via its title, not what
 * will be said in it), `callId` and `meetingUrl`.
 */
export const PUBLIC_EVENT_FIELDS = [
	"id",
	"title",
	"kind",
	"status",
	"start",
	"end",
	"allDay",
	"masked",
	"accent",
	"location",
	"meta",
	"attendees",
	"capacity",
	"sources",
	"href",
	"bookable",
	"callType",
	"feeAmountMinor",
	"feeCurrency",
] as const satisfies readonly (keyof CalendarEvent)[];

/** Copy the defined subset of `keys` from `src`, so an absent optional stays absent. */
function copyDefined<T extends object, K extends keyof T>(src: T, keys: readonly K[]): Pick<T, K> {
	const out = {} as Pick<T, K>;
	for (const key of keys) {
		if (src[key] !== undefined) out[key] = src[key];
	}
	return out;
}

/**
 * The event as this viewer is allowed to receive it: untouched for a party, reduced to
 * {@link PUBLIC_EVENT_FIELDS} for everyone else.
 *
 * A MASKED block is reduced further still. Masking exists to say "this time is taken" without saying
 * what takes it, and `sources` answers a question the mask is there to refuse: which calendar the
 * private thing lives in. Reading someone's public availability page and learning that their unnamed
 * Thursday block is a Google event — while their named ones are not — is provenance about a private
 * appointment. The surfaces already decline to DRAW a provider mark on a masked block; withholding
 * it here means it never crosses the wire either, which is the difference between a rendering choice
 * and a privacy guarantee. `sources` stays public on an unmasked event, where it is what the
 * provider filter and the stacked provider marks are built from.
 */
export function redactEventForViewer(
	event: CalendarEvent,
	viewer: SchedulingViewer,
): CalendarEvent {
	if (isEventParty(event, viewer)) return event;
	const shown = copyDefined(event, PUBLIC_EVENT_FIELDS);
	if (shown.masked) delete (shown as { sources?: unknown }).sources;
	return shown;
}

/** {@link redactEventForViewer} across a whole page's worth of events. */
export function redactEventsForViewer(
	events: readonly CalendarEvent[],
	viewer: SchedulingViewer,
): CalendarEvent[] {
	return events.map((event) => redactEventForViewer(event, viewer));
}
// #endregion
