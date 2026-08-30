import type {
	CalendarEvent,
	EventAttendee,
	EventHistoryEntry,
	EventMeeting,
	EventPricing,
	EventReschedule,
	MeetingProvider,
	RescheduleProposal,
	RsvpResponse,
	SchedulingParty,
	SchedulingSim,
	SchedulingViewer,
} from "@projective/types/scheduling";
import {
	canReschedule,
	eligibleVoterCount,
	isRescheduleClosed,
	leadingProposal,
	MEETING_PROVIDER_LABEL,
	rescheduleModeFor,
	settleVote,
	voteResolvesAt,
} from "@projective/types/scheduling";
import type { AssetItem } from "@projective/types/files";
import type { MoneyView } from "@projective/types/finance";
import { DEFAULT_LOCALE, formatMoney, PLATFORM_BASE_CURRENCY } from "@projective/types/finance";
import { DAY, hash, HOUR, NOW } from "./derive.ts";
import { serverEnv } from "../../core/env.ts";
import { mockAvatar } from "../../mocks/assets.ts";

/**
 * Event COORDINATION fixtures — the deterministic roster, room, money, reschedule negotiation and
 * audit log the fat {@link ScheduleBackendService} hangs off a calendar event while the surfaces'
 * backend gates are off.
 *
 * Every value derives from the shared unsigned `hash()` and the FIXED reference clock in
 * `./derive.ts`, so SSR and the island refetch agree byte-for-byte and a resume replays identically.
 * The hash is unsigned deliberately: a signed `>>` has produced a negative array index and a literal
 * "undefined" in this codebase before (root CLAUDE.md §8 Decision #48).
 *
 * **Money is computed here, on the server, and only here.** A seat price times a paid-seat count is
 * multiplied once, into a {@link MoneyView} whose `display` string the client renders verbatim — the
 * client never multiplies money (root CLAUDE.md §8 Decisions #55/#60).
 *
 * **Only three kinds get coordination.** A `session`, a `sync` and a `booking` are arrangements
 * between people; a `deadline`, a `milestone`, a `holiday` or a masked external `busy` block is not,
 * and giving one a roster would invent participants nobody invited. A masked block never receives a
 * roster, a room or a money figure at all — the whole point of masking is that only the status label
 * leaks (§Part 1.4).
 *
 * **This module composes the full projection; it does not decide who may SEE it.** Masking is not a
 * privacy boundary — a public group session is deliberately unmasked — so the withholding rule lives
 * in `@projective/types/scheduling` `./privacy.ts` and is applied by the fat service on the way out
 * ({@link ScheduleBackendService}). What this module does own is the SEATING: a guest is seated
 * nowhere, which is what makes the projection answer "not a party" for them.
 */

// #region Cast
const FACE = (id: string) =>
	mockAvatar(id);

/**
 * The fallback cast for a surface that has no real domain parties of its own to draw on.
 *
 * **One handle, one person.** Every entry here matches the name the rest of the platform already
 * gives that handle (`projects/detail-fixtures` CAST, `explore/fixtures`, `messaging/
 * conversation-fixtures`), because a handle is an IDENTITY and `profileHref` sends every spelling of
 * it to the same profile page. `@sofia` used to read "Sofia Almeida" here and "Sofia Marin"
 * everywhere else, so two different people linked to one profile — the roster test below now pins
 * the invariant across the whole corpus so a future addition cannot reintroduce it.
 */
const POOL: readonly SchedulingParty[] = [
	{ name: "Ivy Chen", avatar: FACE("photo-1487412720507-e7ab37603c6f"), handle: "ivy" },
	{ name: "Marcus Lee", avatar: FACE("photo-1519085360753-af0119f7cbe7"), handle: "marcus" },
	{ name: "Aria Novak", avatar: FACE("photo-1524504388940-b1c1722653e1"), handle: "aria" },
	{ name: "Ravi Menon", avatar: FACE("photo-1508214751196-bcfd4ca60f91"), handle: "ravi" },
	{ name: "Noor Haddad", avatar: FACE("photo-1544005313-94ddf0286df2"), handle: "noor" },
	{ name: "Tomas Brandt", avatar: FACE("photo-1500648767791-00dcc994a43e"), handle: "tomas" },
	{ name: "Sofia Marin", avatar: FACE("photo-1534528741775-53994a69daeb"), handle: "sofia" },
	{ name: "Dan Okafor", avatar: FACE("photo-1506794778202-cad84cf45f1d"), handle: "dan" },
];

/**
 * The response cycle. Weighted toward `accepted` because a schedule of mostly-declined sessions is
 * not a representative fixture, and the surfaces being built read very differently at each mix.
 */
const RESPONSES: readonly RsvpResponse[] = [
	"accepted",
	"accepted",
	"tentative",
	"pending",
	"accepted",
	"rejected",
];

/** The room-minting rotation. `custom` is in it so the "host pasted their own link" branch renders. */
const PROVIDERS: readonly MeetingProvider[] = ["zoom", "google", "microsoft_teams", "custom"];
// #endregion

// #region Context
/** What a surface knows about an event that the event itself does not carry. */
export interface CoordinationContext {
	/**
	 * Identifies the PAGE, not the event. A calendar event id (`sync-{stageId}`, `av-0`) is unique
	 * only within the page that derived it, so both the hash seed and the mutation store key are
	 * qualified by this.
	 */
	surfaceKey: string;
	/** The event's host — the party a reschedule is negotiated with. */
	host: SchedulingParty;
	/** Real domain parties to prefer over {@link POOL} (project members, cohort members). */
	cast?: readonly SchedulingParty[];
	/**
	 * Who is asking. A guest is seated NOWHERE — no `isViewer` row, never the host — which is what
	 * makes {@link isEventParty} answer `false` for them and the service withhold the roster, the
	 * room, the money and the negotiation ({@link "./privacy.ts"}). With the backend gates off an
	 * AUTHENTICATED reader is still seated by designation rather than by identity, so the write path
	 * stays exercisable; the live path replaces the designation, not the projection.
	 */
	viewer: SchedulingViewer;
	/**
	 * Whether this SURFACE seats its viewer as the host (a project's delivery side owns its calendar;
	 * a public availability page never does). Only takes effect for an authenticated viewer.
	 */
	viewerHostsSurface: boolean;
	/** IANA zone for the human date labels on history lines. */
	timezone: string;
	/** Occurrences still to come in a recurring series, this one included. `1` for a one-off. */
	remainingOccurrences?: number;
	/**
	 * The developer simulation overlay, when one was asked for.
	 *
	 * It moves the INPUTS this module derives from — where the viewer sits, how many people are on
	 * the arrangement, which negotiation state is live, what the acting seat answered — and never a
	 * verdict: {@link rescheduleModeFor}, {@link canReschedule} and {@link settleVote} still decide
	 * everything they decided before, so a simulated event is subject to the same rules as a real one.
	 * Absent on the live path.
	 */
	sim?: SchedulingSim;
}

/** Where the acting viewer sits on an event, after the simulation overlay has had its say. */
type Seat = "host" | "attendee" | "none";

/**
 * Whether the developer simulation overlay may be honoured at all.
 *
 * The overlay lets a caller name the seat they want to be given, and a seat decides whether the
 * privacy projection hands over the join URL, the roster, the notes and the host's earnings. That is
 * a description of an authorisation, so it can only ever be trusted where the SERVER — not the
 * request — says it is a development environment. `sim` arrives on the query string of a read and in
 * the body of a write, both fully caller-controlled, so without this gate `sim.seat: "host"` is a
 * privilege-forgery primitive that ships to production.
 */
function simulationAllowed(): boolean {
	return serverEnv().appEnv === "development";
}

/**
 * Resolve the viewer's seat.
 *
 * Seating is by IDENTITY, not by the fact of being signed in. The earlier rule — "authenticated ⇒
 * attendee unless the surface says otherwise" — is correct on a surface a viewer owns, but two of
 * this domain's surfaces show OTHER people's calendars to anyone who asks (`/[handle]/availability`
 * and `/view/[entity]/schedule`). There, seating every signed-in reader as an attendee handed a
 * stranger the host's join URL, passcode, the named roster with its RSVP answers and private notes,
 * and the host's per-occurrence and per-series earnings. Being signed in is not a relationship to
 * somebody else's meeting.
 *
 * So: a viewer is the host when the surface is one they host (their own project calendar, their own
 * availability page) or when their handle IS the host's; they are an attendee only when their handle
 * is actually on the roster this event derived; otherwise they are seated nowhere and
 * {@link isEventParty} answers `false` for them.
 *
 * A GUEST is seated nowhere whatever the overlay claims, and the overlay itself is honoured only in
 * development ({@link simulationAllowed}).
 */
function resolveSeat(ctx: CoordinationContext, rosterHandles: readonly string[]): Seat {
	if (!ctx.viewer.authenticated) return "none";
	switch (ctx.sim?.seat) {
		case "non_party":
			return "none";
		case "host":
			return "host";
		case "attendee":
			return "attendee";
		default:
			break;
	}

	if (ctx.viewerHostsSurface) return "host";
	const me = bare(ctx.viewer.handle);
	if (!me) return "none";
	if (bare(ctx.host.handle) === me) return "host";
	return rosterHandles.includes(me) ? "attendee" : "none";
}
// #endregion

// #region Mutation store (the fixture write path)
/**
 * What a write has changed about an event, layered over the derived projection on the next read.
 *
 * Per-process and unpersisted, exactly like the catalogue and wallet fixture stores (root CLAUDE.md
 * §8 Decisions #53/#55): it exists so an RSVP or a reschedule is genuinely exercisable with the gate
 * off. It starts EMPTY, so the first SSR paint and the island's first refetch still agree; only
 * after a write does the process diverge, which is the intended and documented behaviour.
 */
interface EventOverlay {
	viewerResponse?: RsvpResponse;
	viewerNote?: string | null;
	reschedule?: EventReschedule;
}

const OVERLAY = new Map<string, EventOverlay>();

/** The store key for one event on one surface. */
export function overlayKey(surfaceKey: string, eventId: string): string {
	return `${surfaceKey}::${eventId}`;
}

/** Read the overlay for an event, if it has been written to. */
export function readOverlay(key: string): EventOverlay | undefined {
	return OVERLAY.get(key);
}

/** Record the viewer's own RSVP. A viewer may only ever answer for themselves. */
export function writeRsvpOverlay(key: string, response: RsvpResponse, note: string | null): void {
	const cur = OVERLAY.get(key) ?? {};
	OVERLAY.set(key, { ...cur, viewerResponse: response, viewerNote: note });
}

/** Replace the whole negotiation — the fat service composes the new state and hands it over. */
export function writeRescheduleOverlay(key: string, reschedule: EventReschedule): void {
	const cur = OVERLAY.get(key) ?? {};
	OVERLAY.set(key, { ...cur, reschedule });
}
// #endregion

// #region Derivation
/** {@link POOL} indexed by bare handle — the scheduling domain's identity table. */
const POOL_BY_HANDLE = new Map(POOL.map((p) => [p.handle as string, p]));

/**
 * One handle form, and one PERSON, per handle.
 *
 * Two normalisations, both because a handle is an identity rather than a label:
 *
 * 1. **Form.** The parties these fixtures compose come from three domains that spell a handle
 *    differently — the profile corpus stores `@ivy`, the projects and explore corpora store `ivy` —
 *    so a roster built from a mix would carry both, and a link builder that prepends `@` would emit
 *    `/@ivy` for one seat and `/@@ivy` for the next.
 *
 * 2. **Identity.** `profileHref` sends every seat carrying `@ivy` to the same profile, so two
 *    display names under that handle send two different-looking people to one page. The profile
 *    corpus synthesises a short name for a handle it does not know (`findProfile("ivy").name` is
 *    "Ivy"), while the projects, explore and messaging corpora all say "Ivy Chen" — so an
 *    availability page hosted by "Ivy" sat in a corpus where every other surface called her "Ivy
 *    Chen". {@link POOL} is this domain's identity table and wins for the handles it names.
 *
 * ⚠️ That divergence is PLATFORM-wide, not local: `/@ivy` itself still renders "Ivy" because the
 * profile fixtures own that page. Reconciling the profile corpus with the rest is a change to
 * another feature's fixtures and is flagged rather than made here.
 */
function normaliseParty(party: SchedulingParty): SchedulingParty {
	if (!party.handle) return party;
	const handle = party.handle.replace(/^@+/, "");
	return POOL_BY_HANDLE.get(handle) ?? { ...party, handle };
}

function money(minor: number): MoneyView {
	return {
		minor,
		currency: PLATFORM_BASE_CURRENCY,
		display: formatMoney(minor, PLATFORM_BASE_CURRENCY, DEFAULT_LOCALE),
		origin: null,
	};
}

const labelFmtCache = new Map<string, Intl.DateTimeFormat>();
function dateLabel(ms: number, tz: string): string {
	let f = labelFmtCache.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat("en-GB", {
			timeZone: tz,
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		labelFmtCache.set(tz, f);
	}
	return f.format(new Date(ms));
}

/**
 * The identity key two parties are the same person under: the handle when there is one, else the
 * folded display name. Handle-first because a handle IS the identity a profile link resolves.
 */
function identityKey(party: SchedulingParty): string {
	return party.handle ? `@${party.handle.toLowerCase()}` : `~${party.name.trim().toLowerCase()}`;
}

/**
 * The people available to fill seats, in a stable order, with the host and every duplicate removed.
 *
 * Both exclusions are load-bearing. The domain casts INCLUDE the owner (`detail.members` carries the
 * project owner, who is also the host), so drawing from them unfiltered seated the host twice — and
 * a two-seat "meeting" of one person with himself then routed down {@link rescheduleModeFor}'s
 * counterparty branch, where the counterparty was the host. And the {@link POOL} overlaps the real
 * casts by design (they are the same people), so concatenating them duplicated whoever appeared in
 * both.
 */
function availableCast(ctx: CoordinationContext): SchedulingParty[] {
	const seen = new Set<string>([identityKey(normaliseParty(ctx.host))]);
	const out: SchedulingParty[] = [];
	for (const raw of [...(ctx.cast ?? []), ...POOL]) {
		const party = normaliseParty(raw);
		const key = identityKey(party);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(party);
	}
	return out;
}

/** A handle compared the way people type it — no leading `@`, case-insensitively. */
function bare(handle: string | null | undefined): string {
	return (handle ?? "").replace(/^@/, "").toLowerCase();
}

/**
 * The non-host seats of an event, in order.
 *
 * Extracted so that WHO is on the roster is decided in exactly one place. The seat resolution has to
 * know the membership (a viewer is an attendee only if they are actually on it) and the roster has
 * to know the seat (to mark the viewer's own row), and deriving the two from separate copies of this
 * selection is how they would come to disagree about who is in the room.
 */
function attendeeCast(
	ctx: CoordinationContext,
	seed: number,
	size: number,
): readonly SchedulingParty[] {
	const cast = availableCast(ctx);
	const seats = Math.min(size - 1, cast.length);
	const out: SchedulingParty[] = [];
	for (let i = 0; i < seats; i++) out.push(cast[(seed + i) % cast.length]);
	return out;
}

/**
 * The participant list. The host occupies the first seat and is counted; every other seat is a
 * DISTINCT person, so `roster.length` is a head count of people rather than of slots filled.
 *
 * `size` is treated as a ceiling, not a target: a surface asking for twelve attendees out of a cast
 * of nine gets nine. Inventing the other three by wrapping the modulo would seat the same person
 * repeatedly, which is worse than a smaller meeting.
 */
function buildRoster(
	event: CalendarEvent,
	ctx: CoordinationContext,
	seed: number,
	size: number,
	seat: Seat,
	viewerIndex: number,
): EventAttendee[] {
	const cast = attendeeCast(ctx, seed, size);
	const viewerIsHost = seat === "host";
	const roster: EventAttendee[] = [
		{
			...normaliseParty(ctx.host),
			id: `${event.id}:host`,
			role: "host",
			response: "accepted",
			respondedAt: answeredAt(event, hash(`${ctx.surfaceKey}:${event.id}:host`)),
			isViewer: viewerIsHost,
			note: null,
		},
	];

	for (let i = 0; i < cast.length; i++) {
		const h = hash(`${ctx.surfaceKey}:${event.id}:att:${i}`);
		const who = cast[i];
		const response = RESPONSES[h % RESPONSES.length];
		roster.push({
			...who,
			id: `${event.id}:a${i}`,
			role: h % 7 === 0 ? "optional" : "participant",
			response,
			// `null` while pending is the schema's own documented invariant, and `buildHistory` filters
			// on it — an answer time on an unanswered seat would log "Marked Maybe" for somebody who
			// said nothing.
			respondedAt: response === "pending" ? null : answeredAt(event, h),
			// Exactly one "your row" for the RSVP control to gate on, and it is the seat the viewer
			// ACTUALLY occupies — `viewerIndex` was resolved by matching their handle against this same
			// cast. A GUEST, a stranger, and a viewer the overlay has deliberately un-seated all get no
			// row at all, which is what stops the projection treating them as a party.
			isViewer: seat === "attendee" && i === viewerIndex,
			note: h % 11 === 0 ? "Joining ten minutes late." : null,
		});
	}
	return roster;
}

/**
 * When somebody answered: a real instant in the PAST, and before the thing they were answering
 * about.
 *
 * Anchoring on `event.start` alone produced answer times in the future for every event more than a
 * few days out — 298 of them across the corpus — which then fed a history log that recorded
 * tomorrow. `Math.min(NOW, event.start)` gives the honest ceiling: for a future event you answered
 * by now, for a past one you answered before it began.
 */
function answeredAt(event: CalendarEvent, h: number): number {
	return Math.min(NOW, event.start) - (6 + (h % 60)) * HOUR;
}

function buildMeeting(event: CalendarEvent, seed: number): EventMeeting {
	const provider = PROVIDERS[seed % PROVIDERS.length];
	const room = (seed % 900_000_000 + 100_000_000).toString();
	const pending = event.status === "tentative";
	return {
		provider,
		providerLabel: provider === "custom" ? "Studio call bridge" : MEETING_PROVIDER_LABEL[provider],
		// `example.com` is reserved by RFC 2606 — a fixture must never emit a link that would send a
		// reader (or a link-preview crawler) to a real third party.
		joinUrl: pending ? null : `https://call.example.com/${provider}/${room}`,
		passcode: seed % 3 === 0 ? String(100_000 + (seed % 899_999)) : null,
		details: provider === "custom" ? "Dial-in: +44 20 7946 0000, then the passcode." : null,
		pending,
	};
}

/**
 * What the occurrence is worth. A group session sells SEATS (everyone but the host pays); a 1-on-1
 * booking is either a courtesy call — free, and explicitly so — or a single priced consultation.
 */
function buildPricing(
	event: CalendarEvent,
	seed: number,
	rosterSize: number,
	remainingOccurrences: number,
): EventPricing | undefined {
	if (event.kind === "session") {
		const unitMinor = 1500 + (seed % 18) * 500; // £15.00 – £100.00
		const paidSeats = Math.max(0, rosterSize - 1);
		const occurrence = unitMinor * paidSeats;
		return {
			model: "per_seat",
			unitPrice: money(unitMinor),
			paidSeats,
			occurrenceEarnings: money(occurrence),
			seriesEarnings: remainingOccurrences > 1 ? money(occurrence * remainingOccurrences) : null,
			remainingOccurrences,
			viewerHasPaid: seed % 2 === 0,
		};
	}
	if (event.kind === "booking") {
		// A courtesy call carries no money at all — never a zero price, which would read as "priced
		// at nothing" rather than "deliberately free" (see `calls.ts` §The central distinction).
		const paid = seed % 3 === 0;
		if (!paid) {
			return {
				model: "free",
				unitPrice: null,
				paidSeats: 0,
				occurrenceEarnings: null,
				seriesEarnings: null,
				remainingOccurrences: 1,
				viewerHasPaid: false,
			};
		}
		const unitMinor = 7500 + (seed % 10) * 2500; // £75.00 – £300.00
		return {
			model: "per_session",
			unitPrice: money(unitMinor),
			paidSeats: 1,
			occurrenceEarnings: money(unitMinor),
			seriesEarnings: null,
			remainingOccurrences: 1,
			viewerHasPaid: true,
		};
	}
	return undefined;
}

/**
 * A live negotiation, on a minority of events.
 *
 * Only ever attached to an event that is still outside the reschedule lockout, so the fixture world
 * and {@link canReschedule} cannot disagree — a surface must never be handed an open vote on a
 * session it is simultaneously told is too late to move.
 */
function buildReschedule(
	event: CalendarEvent,
	ctx: CoordinationContext,
	seed: number,
	roster: readonly EventAttendee[],
	force = false,
): EventReschedule | undefined {
	// The lockout is NOT waived by `force`. A negotiation on an event that {@link canReschedule} says
	// cannot be moved is a contradiction the surface would have to render both halves of, and the
	// developer reaching for the simulation deserves the honest refusal rather than an impossible
	// ballot.
	if (!canReschedule(NOW, event.start)) return undefined;

	const group = rescheduleModeFor(roster.length) === "vote";
	if (!force && group && seed % 3 !== 0) return undefined;
	if (!force && !group && seed % 2 !== 0) return undefined;

	const proposals: RescheduleProposal[] = [];
	const count = group ? 2 + (seed % 2) : 1;
	for (let i = 0; i < count; i++) {
		const h = hash(`${ctx.surfaceKey}:${event.id}:prop:${i}`);
		const start = event.start + (24 + i * 24 + (h % 6)) * HOUR;
		proposals.push({
			id: `${event.id}-p${i}`,
			start,
			end: start + (event.end - event.start),
			proposedBy: normaliseParty(ctx.host),
			proposedByRole: "host",
			proposedAt: NOW - (12 + (h % 36)) * HOUR,
			approved: true,
			note: i === 0 ? "Clashes with a client review — two alternatives below." : null,
			votes: [],
		});
	}

	// One outstanding client request on some group votes, so the approval gate has something to act
	// on: it is deliberately NOT on the ballot until the host approves it.
	if (group && seed % 2 === 0) {
		const client = roster.find((a) => a.role !== "host") ?? roster[0];
		const h = hash(`${ctx.surfaceKey}:${event.id}:clientprop`);
		const start = event.start + (18 + (h % 10)) * HOUR;
		proposals.push({
			id: `${event.id}-pc`,
			start,
			end: start + (event.end - event.start),
			proposedBy: { name: client.name, avatar: client.avatar, handle: client.handle },
			proposedByRole: "attendee",
			proposedAt: NOW - (2 + (h % 8)) * HOUR,
			approved: false,
			note: "Could we push it later in the day?",
			votes: [],
		});
	}

	if (group) {
		/*
		 * Deterministic ballot: each non-host seat backs one option, or abstains.
		 *
		 * Three archetypes, because majority resolution has three drawable states and a corpus that
		 * only ever produces one of them leaves the others undrawable and untestable:
		 *   `rallied`  — a high turnout all backing the same slot → carries, and settles on the read.
		 *   `pending`  — a third abstain, votes spread → stays open, which is the state most surfaces
		 *                spend their time rendering.
		 *   `deadlock` — everybody votes, nobody agrees → the question is finished and no slot reached
		 *                a majority, so it lapses and the original time stands.
		 *
		 * Turnout is part of the archetype because a majority is measured against everyone ENTITLED to
		 * vote, not everyone who did: at a one-in-three abstention rate a four-seat cohort tops out at
		 * three votes against a quorum of three, so unanimity among those who bothered would carry
		 * only by luck.
		 *
		 * Hashed on its own key rather than read off `seed`, which already decides the ballot SIZE two
		 * lines up: correlating the two tied the archetype to the number of options, and the whole
		 * project-calendar subset then landed on the same side of it with no carried vote in it.
		 */
		const archetype = hash(`${ctx.surfaceKey}:${event.id}:ballot`) % 3;
		const ballot = proposals.filter((p) => p.proposedByRole === "host");
		roster.forEach((a) => {
			if (a.role === "host") return;
			// Keyed on WHO is voting, not on their seat index. `hash` multiplies by 31, and 31 ≡ 1
			// (mod 3), so two keys differing only in a trailing digit hash to values differing by one —
			// `h % 3` then cycled 0,1,2 down every roster in the corpus and produced the identical
			// abstention pattern and the identical tally on every single group vote. A person's own
			// identity is both better mixed and the honest thing to key a person's decision on.
			const h = hash(`${ctx.surfaceKey}:${event.id}:vote:${a.handle ?? a.name}`);
			const abstains = archetype === 0 ? h % 7 === 0 : archetype === 1 ? h % 3 === 0 : false;
			if (abstains) return;
			const target = archetype === 0 ? ballot[0] : ballot[h % ballot.length];
			target.votes.push({
				name: a.name,
				avatar: a.avatar,
				handle: a.handle,
				attendeeId: a.id,
				at: NOW - (1 + (h % 20)) * HOUR,
			});
		});
	}

	return {
		mode: group ? "vote" : "counterparty",
		status: group ? "voting" : "awaiting_counterparty",
		openedBy: normaliseParty(ctx.host),
		openedAt: NOW - (14 + (seed % 20)) * HOUR,
		proposals,
		resolvesAt: group ? voteResolvesAt(proposals) : null,
		resolvedProposalId: null,
		round: 0,
	};
}

/**
 * Force the negotiation into the state the developer asked for, without waiving a single rule.
 *
 * Two deliberate refusals to obey the overlay literally:
 *
 *  1. **The MODE is never overridden.** It is a property of the event (how many people have to
 *     agree), so a `voting` ask on a two-person arrangement lands on `awaiting_counterparty` and an
 *     `awaiting_counterparty` ask on a cohort lands on `voting`. Honouring the literal ask would let
 *     the switcher produce a state the service itself cannot reach, and the surface would then be
 *     drawing a "vote" of one.
 *  2. **A forced `voting` round is trimmed to stay askable.** {@link settleVote} runs on every read,
 *     and a ballot every eligible voter has already answered is settleable — so a forced live vote
 *     built from a fully-voted fixture would resolve on the same read it was requested in, and the
 *     one state the developer asked to look at would be the one they could not see.
 */
function applyRescheduleSim(
	derived: EventReschedule | undefined,
	event: CalendarEvent,
	ctx: CoordinationContext,
	seed: number,
	roster: readonly EventAttendee[],
): EventReschedule | undefined {
	const target = ctx.sim?.reschedule;
	if (!target) return derived;
	if (target === "none") return undefined;

	const base = derived ?? buildReschedule(event, ctx, seed, roster, true);
	if (!base) return undefined;
	if (base.proposals.length === 0) return { ...base, status: "none" };

	const wantsVote = base.mode === "vote";
	const status = isRescheduleClosed(target) || target === "collecting"
		? target
		: wantsVote
		? "voting"
		: "awaiting_counterparty";

	if (status === "collecting") {
		return { ...base, status, resolvesAt: null, resolvedProposalId: null };
	}
	if (status === "withdrawn") {
		return { ...base, status, resolvesAt: null, resolvedProposalId: null };
	}
	if (status === "lapsed") {
		return { ...base, status, resolvedProposalId: null };
	}
	if (status === "resolved") {
		const won = leadingProposal(base.proposals) ?? base.proposals[0];
		return { ...base, status, resolvedProposalId: won.id };
	}
	if (status === "awaiting_counterparty") {
		return { ...base, status, resolvesAt: null, resolvedProposalId: null };
	}

	/*
	 * Live vote, left in a state a developer can actually act on.
	 *
	 * Two trims. The ACTING SEAT's own ballot is removed first, because the derived corpus casts a vote
	 * for every non-host seat — including whoever is being simulated — so a forced "open vote" answered
	 * every control on the tab with `duplicate_vote` and the one interaction the state exists to
	 * exercise was unreachable. Then, if the remaining turnout still accounts for everybody entitled to
	 * answer, one more is dropped: `settleVote` runs on this same read, and a question everybody has
	 * answered is settleable, so the round would resolve in the instant it was requested.
	 */
	const voters = eligibleVoterCount(roster);
	const me = roster.find((a) => a.isViewer);
	let proposals = me
		? base.proposals.map((p) => ({ ...p, votes: p.votes.filter((v) => v.attendeeId !== me.id) }))
		: base.proposals;
	while (voters > 0 && proposals.reduce((n, p) => n + p.votes.length, 0) >= voters) {
		const lastWithVotes = [...proposals].reverse().find((p) => p.votes.length > 0);
		if (!lastWithVotes) break;
		proposals = proposals.map((p) =>
			p.id === lastWithVotes.id ? { ...p, votes: p.votes.slice(0, -1) } : p
		);
	}
	return {
		...base,
		status: "voting",
		proposals,
		resolvesAt: voteResolvesAt(proposals),
		resolvedProposalId: null,
	};
}

/**
 * The agenda pack hung on an occurrence — the same {@link AssetItem} rows the `/files` hub and the
 * ticket modal render, so one set of cards, tables and preview panes serves all three.
 *
 * Provenance is left NULL throughout, which is the honest answer: an event is not a channel and
 * nothing here was posted in a message. That is precisely what the widening recorded in Decision #67
 * made expressible, and it is why this needs no scheduling-local file shape.
 */
const ATTACHMENT_KIT: ReadonlyArray<
	{
		name: string;
		ext: string;
		kind: AssetItem["kind"];
		category: AssetItem["category"];
		kb: number;
	}
> = [
	{ name: "Agenda", ext: "pdf", kind: "pdf", category: "Document", kb: 184 },
	{ name: "Session deck", ext: "pdf", kind: "pdf", category: "Presentation", kb: 2_640 },
	{ name: "Reference board", ext: "png", kind: "image", category: "Image", kb: 940 },
	{ name: "Last session notes", ext: "md", kind: "doc", category: "Document", kb: 12 },
	{ name: "Recording", ext: "mp4", kind: "video", category: "Video", kb: 48_200 },
];

/**
 * The agenda body, as the shared `RichTextEditor` would have emitted it.
 *
 * Only the six formats that editor allows can appear here (bold · italic · underline · strike ·
 * H1–H3 · lists), so what the modal renders is a small closed vocabulary rather than "whatever HTML
 * arrives" — the same contract the ticket brief holds to. Derived from the event itself rather than
 * picked from a pool, so the copy and the block that opened it agree.
 */
function buildDescription(event: CalendarEvent, host: SchedulingParty): string {
	const what = event.kind === "session" ? "session" : event.kind === "booking" ? "call" : "meeting";
	return `<p>${host.name} is running this ${what}.` +
		`${event.location ? ` It happens at <strong>${event.location}</strong>.` : ""}</p>` +
		`<p>Bring anything outstanding from last time — the agenda pack is attached, and the notes ` +
		`are written up here afterwards.</p>`;
}

function sizeLabel(bytes: number): string {
	if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
	if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${bytes} B`;
}

function buildAttachments(
	event: CalendarEvent,
	ctx: CoordinationContext,
	seed: number,
	host: SchedulingParty,
): AssetItem[] {
	const count = seed % 4; // 0–3 — an event with no pack is the common case and must render
	const out: AssetItem[] = [];
	for (let i = 0; i < count; i++) {
		const h = hash(`${ctx.surfaceKey}:${event.id}:asset:${i}`);
		const kit = ATTACHMENT_KIT[h % ATTACHMENT_KIT.length];
		const bytes = kit.kb * 1024;
		// Anchored before the event and never after the clock, for the same reason every history line
		// is: a file "added" tomorrow is not a fact about an occurrence that has not happened.
		const at = Math.min(NOW, event.start) - (2 + (h % 20)) * DAY;
		out.push({
			id: `${event.id}-f${i}`,
			kind: kit.kind,
			category: kit.category,
			name: `${kit.name}.${kit.ext}`,
			ext: kit.ext,
			// RFC 2606 reserves `example.com`, so a fixture can never send a reader (or a link-preview
			// crawler) to a real third party.
			url: `https://files.example.com/${event.id}/${i}.${kit.ext}`,
			thumbnailUrl: null,
			sizeBytes: bytes,
			sizeLabel: sizeLabel(bytes),
			width: null,
			height: null,
			durationLabel: kit.kind === "video" ? "24:10" : null,
			channelId: null,
			channelName: null,
			channelKind: null,
			messageId: null,
			messageText: null,
			messageAudioUrl: null,
			sender: {
				id: host.handle ?? host.name,
				name: host.name,
				avatar: host.avatar,
				handle: host.handle,
			},
			createdAt: new Date(at).toISOString(),
			timeLabel: dateLabel(at, ctx.timezone),
			dayLabel: dateLabel(at, ctx.timezone),
			dateLabel: dateLabel(at, ctx.timezone),
			starred: h % 5 === 0,
			source: "supabase",
			status: "uploaded",
			// An event's pack is reachable by everyone the event is — the same one-directional
			// elevation an attachment inside a channel gets, and for the same reason: a participant
			// who can read the invitation must be able to open what it carries.
			visibility: "link",
			ownerType: "user",
			ownerId: host.handle ?? host.name,
			folderId: null,
			folderPath: [],
			contentHash: null,
			hashSampled: false,
			external: null,
			link: null,
			shareSlug: null,
			downloadCount: h % 12,
			downloadedByViewer: false,
			// Only the host manages the pack; an attendee reads and downloads it.
			canManage: ctx.viewer.authenticated && ctx.viewerHostsSurface,
		});
	}
	return out;
}

/** What an RSVP reads as in the log. Total over the enum, so no answer falls through to another. */
const RSVP_HISTORY_SUMMARY: Record<RsvpResponse, string> = {
	accepted: "Marked Going",
	rejected: "Marked Not going",
	tentative: "Marked Maybe",
	// Reachable: clearing an answer is a legitimate move, and it is not the same as answering Maybe.
	// The log filters unanswered seats out before this is read, so it exists to keep the map total.
	pending: "Cleared their response",
};

function buildHistory(
	event: CalendarEvent,
	ctx: CoordinationContext,
	seed: number,
	roster: readonly EventAttendee[],
	reschedule: EventReschedule | undefined,
): EventHistoryEntry[] {
	const out: EventHistoryEntry[] = [];
	const push = (
		kind: EventHistoryEntry["kind"],
		at: number,
		actor: SchedulingParty | null,
		summary: string,
		detail: string | null,
		targetId: string | null,
	) => {
		const elapsed = NOW - at;
		out.push({
			id: `${event.id}-h${out.length}`,
			kind,
			actor,
			summary,
			detail,
			at: new Date(at).toISOString(),
			dateLabel: dateLabel(at, ctx.timezone),
			// Anything in the last day is unread — a per-viewer fact the server owns, so the client
			// never compares a timestamp against a clock it does not control. The lower bound is not
			// redundant: a line stamped after the clock would satisfy `elapsed < 24h` with a NEGATIVE
			// delta, which is how two thirds of the unread badge came to be events that had not
			// happened. Every writer below anchors in the past, and this is the second lock on it.
			unread: elapsed >= 0 && elapsed < 24 * HOUR,
			targetId,
		});
	};

	const host = normaliseParty(ctx.host);
	/*
	 * An append-only log records what HAS happened, so every line is anchored to an instant that is
	 * both in the past and before the event it describes. Anchoring on `event.start` alone dated 154
	 * of the corpus's 498 lines after the clock — "Created this event" in a fortnight's time.
	 */
	const anchor = Math.min(NOW, event.start);
	push("created", anchor - 14 * DAY, host, "Created this event", null, null);

	if (seed % 2 === 0) {
		push(
			"edited",
			anchor - 9 * DAY,
			host,
			"Updated the agenda",
			"Added the review checklist.",
			null,
		);
	}

	const answered = roster.filter((a) => a.role !== "host" && a.respondedAt !== null).slice(0, 3);
	for (const a of answered) {
		push(
			"rsvp",
			a.respondedAt as number,
			{ name: a.name, avatar: a.avatar, handle: a.handle },
			RSVP_HISTORY_SUMMARY[a.response],
			null,
			a.id,
		);
	}

	if (event.meeting?.joinUrl) {
		push(
			"meeting_link",
			anchor - 5 * DAY,
			null,
			`Meeting room created (${event.meeting.providerLabel})`,
			null,
			null,
		);
	}

	if (reschedule) {
		for (const p of reschedule.proposals) {
			push(
				"proposal",
				p.proposedAt,
				p.proposedBy,
				`Proposed ${dateLabel(p.start, ctx.timezone)}`,
				p.approved ? null : "Waiting on the host to approve this time.",
				p.id,
			);
			for (const v of p.votes.slice(0, 2)) {
				push(
					"vote",
					v.at,
					{ name: v.name, avatar: v.avatar, handle: v.handle },
					`Voted for ${dateLabel(p.start, ctx.timezone)}`,
					null,
					p.id,
				);
			}
		}
		// A vote that has come to rest gets its own line, with NO actor: the deadline resolved it, not
		// a person. It is the one transition on this surface nobody performs, so a log that omitted it
		// would show a cohort voting and then, unexplained, a different time.
		if (reschedule.status === "resolved" || reschedule.status === "lapsed") {
			const won = reschedule.proposals.find((p) => p.id === reschedule.resolvedProposalId);
			push(
				"rescheduled",
				Math.min(NOW, reschedule.resolvesAt ?? NOW),
				null,
				won ? `Moved to ${dateLabel(won.start, ctx.timezone)}` : "Vote closed without a majority",
				won ? "Carried by a majority of the attendees." : "The original time stands.",
				won?.id ?? null,
			);
		}
	}

	return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 40);
}
// #endregion

// #region Entry point
/**
 * Decorate one calendar event with its coordination projection, then layer any writes this process
 * has recorded over the top. Returns the event untouched when it is not the sort of thing people
 * attend (a deadline, a masked block).
 */
export function withCoordination(event: CalendarEvent, rawCtx: CoordinationContext): CalendarEvent {
	// Strip the simulation overlay ONCE, here, rather than at each of the four places that read it —
	// a fifth reader added later is then safe by construction instead of by remembering.
	const ctx = simulationAllowed() ? rawCtx : { ...rawCtx, sim: undefined };

	if (event.masked) return event;
	if (event.kind !== "session" && event.kind !== "sync" && event.kind !== "booking") return event;

	const seed = hash(`${ctx.surfaceKey}:${event.id}`);
	// A sync or a booking carries no attendee counter of its own; derive a head count so the roster
	// has a size. Syncs start at two on purpose: a 1-on-1 settles a reschedule by confirmation rather
	// than a vote, and a corpus with no two-person meeting in it would leave that whole branch
	// unrenderable. `capacity` caps it where the source declared one — a roster larger than the seats
	// on sale is not a fixture, it is a contradiction.
	const derivedWanted = event.attendees ?? (event.kind === "booking" ? 2 : 2 + (seed % 4));
	// The overlay moves the head count, never the mode: `rescheduleModeFor` still reads the roster it
	// produced, so forcing a shape exercises the real rule rather than bypassing it.
	const wanted = ctx.sim?.scale === "one_to_one"
		? 2
		: ctx.sim?.scale === "group"
		? Math.max(5, derivedWanted)
		: derivedWanted;
	const size = Math.max(2, Math.min(wanted, event.capacity ?? 25, 25));

	// Membership first, then the seat it implies, then the roster that marks it — see `attendeeCast`.
	const cast = attendeeCast(ctx, seed, size);
	const seat = resolveSeat(ctx, cast.map((p) => bare(p.handle)));
	// Where the viewer actually sits. A seat forced by the dev overlay has no matching handle, so it
	// falls back to the first seat — the overlay's whole job is to put the developer somewhere.
	const matched = cast.findIndex((p) => bare(p.handle) === bare(ctx.viewer.handle));
	const viewerIndex = seat === "attendee" ? (matched >= 0 ? matched : 0) : -1;
	const roster = buildRoster(event, ctx, seed, size, seat, viewerIndex);
	// A cast too small to seat anybody beside the host would leave a "meeting" of one, which no
	// arrangement is — and `rescheduleModeFor(1)` would then offer a counterparty negotiation with no
	// counterparty. An event nobody else is at gets no coordination rather than an incoherent one.
	if (roster.length < 2) return event;

	const host = normaliseParty(ctx.host);
	const meeting = buildMeeting(event, seed);
	const pricing = buildPricing(event, seed, roster.length, ctx.remainingOccurrences ?? 1);
	const derivedReschedule = applyRescheduleSim(
		buildReschedule(event, ctx, seed, roster),
		event,
		ctx,
		seed,
		roster,
	);

	const overlay = readOverlay(overlayKey(ctx.surfaceKey, event.id));
	// A real write beats a simulated default: the overlay is something the developer DID on this
	// surface, the sim is only where they asked it to start from.
	const viewerResponse = overlay?.viewerResponse ?? ctx.sim?.rsvp;
	const applied = roster.map((a) =>
		a.isViewer && viewerResponse
			? {
				...a,
				response: viewerResponse,
				// `respondedAt` is `null` while pending — the schema's own invariant, and the one the
				// audit log filters on. Clearing an answer must therefore clear its timestamp, or the
				// log records somebody answering "Maybe" at the moment they said nothing at all.
				respondedAt: viewerResponse === "pending" ? null : NOW,
				note: overlay?.viewerNote ?? null,
			}
			: a
	);
	const stored = overlay?.reschedule ?? derivedReschedule;
	// A vote whose question has finished being asked comes to rest HERE, on the read, because there is
	// no cron in this layer and a deadline that nothing observes is not a deadline. `settleVote` is
	// total and idempotent, so this is safe to apply to a round that has already settled and to one
	// that never will. The live path runs the same function from a sweep.
	const reschedule = stored ? settleVote(NOW, stored, eligibleVoterCount(applied)) : undefined;

	const decorated: CalendarEvent = {
		...event,
		// Only ever RESTATED, never introduced: the counter is a public-schedule affordance (§Part 1.4
		// lets a group session say "8 going" without naming eight people) and `EventBlock` renders a
		// badge for any unmasked event carrying it. Minting one for a stage sync that never had a
		// count would put a people-badge on every project calendar as a side effect of adding rosters.
		...(typeof event.attendees === "number" ? { attendees: applied.length } : {}),
		roster: applied,
		organiser: host,
		viewerIsHost: seat === "host",
		meeting,
		description: buildDescription(event, host),
		attachments: buildAttachments(event, ctx, seed, host),
		...(pricing ? { pricing } : {}),
		...(reschedule ? { reschedule } : {}),
	};
	return { ...decorated, history: buildHistory(decorated, ctx, seed, applied, reschedule) };
}
// #endregion
