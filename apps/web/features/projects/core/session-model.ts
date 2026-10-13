import {
	type DevSeamState,
	type DevSessionBookingStatus,
	type DevSessionState,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";
import type { CohortOffer, SessionWorkspace } from "@projective/types/projects";
import { seatCount } from "@projective/types/projects";
import type { ProjectDetail, ProjectFormat, ProjectParty } from "../types/projects-types.ts";

/**
 * session-model — the pure, DOM-free model behind the session sidebars (Decision #171).
 *
 * A **standard project** is stage-based; a **normal (1-1) session** and a **group session** are
 * session engagements whose sidebar, channel structure and channel-header tabs differ. Everything a
 * session panel shows is the server's {@link SessionWorkspace} — the cohorts and their real occupancy,
 * the sittings, the viewer's seat and its funding, the curriculum, the join link — reshaped here for the
 * two panels. The only substitutions are the DEV-only Context Switcher's (`serviceType`,
 * `sessionBookingStatus`, `multiSubGroup`, `sessionState`), read through the shipping-safe
 * {@link readDevSeam} seam, which is always `null` in production.
 *
 * Times are labelled in UTC with the zone named — the same SSR == client rule the members roster uses —
 * so the first byte and the hydrated island print the same string.
 */

// #region Session kind
/**
 * The effective service archetype: a standard stage-based engagement (`none`), a 1-1 session
 * (`normal`), or a multi-client group session (`group`). Everything session-specific branches on this.
 */
export type SessionKind = "none" | "normal" | "group";

/** Whether an engagement kind is any session (drives the Calendar tab + the session sidebars). */
export function isSession(kind: SessionKind): boolean {
	return kind === "normal" || kind === "group";
}

/** The dev Context Switcher's `serviceType` onto a kind. */
function seamKind(seam: DevSeamState): SessionKind {
	switch (seam.serviceType) {
		case "normal_session":
			return "normal";
		case "group_session":
			return "group";
		default:
			return "none";
	}
}

/**
 * Resolve the effective {@link SessionKind}. Without an override it is the STORED axis —
 * `projects.session_kind` (`ProjectDetail.sessionKind`) on a `session` engagement, `none` on any other
 * format. A caller holding only the format (a board or timeline page, which a session never has) gets
 * `normal` for a session. With an override the dev `serviceType` wins.
 */
export function resolveSessionKind(
	format: ProjectFormat,
	seam: DevSeamState | null,
	stored?: SessionKind,
): SessionKind {
	if (seam) return seamKind(seam);
	if (format !== "session") return "none";
	return stored === "group" ? "group" : "normal";
}

/**
 * Re-resolve the {@link SessionKind} live in an island from the SSR baseline + the active override — the
 * seam's `serviceType` wins when present, else the server-painted baseline stands.
 */
export function liveSessionKind(baseline: SessionKind, seam: DevSeamState | null): SessionKind {
	return seam ? seamKind(seam) : baseline;
}
// #endregion

// #region Time labels
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAY = 86_400_000;

/** "Thu 17 Jul · 14:30 UTC". */
export function sittingLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${hh}:${mm} UTC`;
}

/** "17 Jul" — the curriculum timeline's date. */
export function shortDate(iso: string): { day: string; month: string; weekday: string } {
	const d = new Date(iso);
	return {
		day: String(d.getUTCDate()),
		month: MONTHS[d.getUTCMonth()] ?? "",
		weekday: WEEKDAYS[d.getUTCDay()] ?? "",
	};
}

/** "Live now" · "Today" · "Tomorrow" · "In 3 days" · "Ended", by UTC calendar day. */
export function relativeLabel(startsAt: string, endsAt: string, now: number): string {
	const start = Date.parse(startsAt);
	const end = Date.parse(endsAt);
	if (now >= end) return "Ended";
	if (now >= start) return "Live now";
	const days = Math.floor(start / DAY) - Math.floor(now / DAY);
	if (days <= 0) return "Today";
	if (days === 1) return "Tomorrow";
	return days < 14 ? `In ${days} days` : `In ${Math.round(days / 7)} weeks`;
}

function minutesLabel(startsAt: string, endsAt: string): string {
	const m = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
	return m >= 120 && m % 60 === 0 ? `${m / 60} h` : `${m} min`;
}
// #endregion

// #region Dev preview
/**
 * The Dev Context Switcher's `sessionState` over the real workspace — each state a session's surfaces
 * branch on, previewed on the real data (Decision #171). Not a derivation: the switcher names the
 * state, this fills its shape. A forced `live` cannot conjure the room's URL the server withholds, so
 * the join control previews its open state disabled, saying so.
 */
export function previewWorkspace(
	ws: SessionWorkspace,
	state: DevSessionState | undefined,
	now: number,
): SessionWorkspace {
	if (!state || state === "auto") return ws;
	if (state === "seat_full") {
		return { ...ws, cohorts: ws.cohorts.map((c) => ({ ...c, seats: seatCount(c.seats.total, c.seats.total) })) };
	}
	const next = ws.next ?? null;
	if (state === "live") {
		const startsAt = new Date(now - 5 * 60_000).toISOString();
		const endsAt = new Date(now + 55 * 60_000).toISOString();
		return {
			...ws,
			next: next ? { ...next, startsAt, endsAt, phase: "live" } : next,
			join: ws.join ? { ...ws.join, state: "open", opensAt: startsAt, closesAt: endsAt } : ws.join,
			funding: ws.funding ? { ...ws.funding, state: "in_progress", nextAction: "none" } : ws.funding,
		};
	}
	// `ended` and `release_pending`: every sitting is behind the viewer and the escrow waits out the window.
	return {
		...ws,
		next: next ? { ...next, phase: "ended" } : next,
		join: ws.join ? { ...ws.join, state: "ended", url: null } : ws.join,
		presetEnded: true,
		funding: ws.funding && (state === "release_pending" || ws.funding.state !== "released")
			? { ...ws.funding, state: "in_review", nextAction: "none" }
			: ws.funding,
	};
}

/** The listing's cohort under the same switcher: `seat_full` fills it. */
export function previewCohortOffer(cohort: CohortOffer, state: DevSessionState | undefined): CohortOffer {
	return state === "seat_full" ? { ...cohort, seats: seatCount(cohort.seats.total, cohort.seats.total) } : cohort;
}

/** A session engagement with nothing scheduled — what a dev-simulated session over a non-session row shows. */
export function emptyWorkspace(detail: ProjectDetail, kind: "normal" | "group"): SessionWorkspace {
	return {
		projectId: detail.id,
		slug: detail.slug,
		kind,
		role: detail.viewerIsClient ? "attendee" : "host",
		terms: { seatHoldMinutes: 15, joinLeadMinutes: 10, presenceMinutes: 15, cancelNoticeHours: 24, payoutHours: 24 },
		cohorts: [],
		next: null,
		join: null,
		curriculum: [],
		membership: null,
		funding: null,
		vote: null,
		proposal: null,
		presetEnded: false,
		claimable: null,
		disputes: [],
	};
}
// #endregion

// #region Booking badge
/** A resolved booking-proposal badge for the upcoming-session widget. */
export interface BookingBadge {
	label: string;
	/** A tonal class discriminator (drives the badge colour token, no hardcoded hex). */
	tone: "confirmed" | "pending" | "rescheduled";
	/** A short clarifying note under the badge. */
	note: string;
}

/**
 * The badge for the next sitting's booking state: confirmed, or a reschedule awaiting the other party
 * (proposed by the client, or by the provider).
 */
export function bookingBadge(status: DevSessionBookingStatus): BookingBadge {
	switch (status) {
		case "client_proposed":
			return {
				label: "Pending Proposal",
				tone: "pending",
				note: "The client proposed a new time — awaiting the provider.",
			};
		case "freelancer_proposed":
			return {
				label: "Rescheduled",
				tone: "rescheduled",
				note: "The provider proposed a new time — awaiting the client.",
			};
		case "confirmed":
		default:
			return {
				label: "Confirmed",
				tone: "confirmed",
				note: "This session is booked and confirmed.",
			};
	}
}

/** The workspace's reschedule proposal onto the badge vocabulary. */
function bookingStatusOf(ws: SessionWorkspace): DevSessionBookingStatus {
	if (ws.proposal === "host") return "freelancer_proposed";
	if (ws.proposal === "attendee") return "client_proposed";
	return "confirmed";
}
// #endregion

// #region Session data (1-1)
/** The next booked sitting for the upcoming-session widget. */
export interface UpcomingSession {
	/** "Thu 17 Jul · 14:30 UTC". */
	label: string;
	/** "Tomorrow" · "Live now". */
	relativeLabel: string;
	/** "60 min". */
	durationLabel: string;
	/** The booking-proposal state (drives {@link bookingBadge}). */
	bookingStatus: DevSessionBookingStatus;
}

/** The session counter — "Session 3 of 10", or that nothing is scheduled yet. */
export interface SessionCounter {
	/** No sitting is scheduled (the widget says so rather than inventing one). */
	empty: boolean;
	index: number;
	total: number;
	label: string;
}

/** The full 1-1 session sidebar projection. */
export interface NormalSessionData {
	/** `null` when no sitting is scheduled. */
	upcoming: UpcomingSession | null;
	counter: SessionCounter;
	/** The other party in the 1-1 (the client for a provider viewer, else the provider). */
	party: ProjectParty;
}

/** The 1-1 panel's data, from the workspace (and the dev booking-status override). */
export function normalSessionView(
	ws: SessionWorkspace,
	detail: ProjectDetail,
	seam: DevSeamState | null,
	now: number,
): NormalSessionData {
	const next = ws.next;
	const upcoming: UpcomingSession | null = next
		? {
			label: sittingLabel(next.startsAt),
			relativeLabel: relativeLabel(next.startsAt, next.endsAt, now),
			durationLabel: minutesLabel(next.startsAt, next.endsAt),
			bookingStatus: seam?.sessionBookingStatus ?? bookingStatusOf(ws),
		}
		: null;
	const counter: SessionCounter = next
		? { empty: false, index: next.index, total: next.total, label: `Session ${next.index} of ${next.total}` }
		: { empty: true, index: 0, total: 0, label: ws.presetEnded ? "All sessions done" : "Nothing scheduled yet" };
	return { upcoming, counter, party: detail.client ?? detail.owner };
}
// #endregion

// #region Group session data
/** One cohort, as the group panel lists it (a sub-group of the engagement). */
export interface SubGroup {
	id: string;
	name: string;
	/** "4 of 10 seats remaining" — the cohort's real occupancy. */
	seatsLabel: string;
	/** The next sitting, labelled; `null` when none is scheduled. */
	nextLabel: string | null;
	/** Its next sitting overlaps another cohort's. */
	overlapping: boolean;
	/** The viewer holds a seat on it. */
	joined: boolean;
}

/** A live reschedule vote across the cohort. */
export interface SessionVote {
	prompt: string;
	accepted: number;
	total: number;
}

/** The full group-session sidebar projection. */
export interface GroupSessionData {
	subGroups: SubGroup[];
	/** `null` when no reschedule vote is open. */
	vote: SessionVote | null;
	/** Whether every sitting has ended (unlocks the 1-1 continuation). */
	presetEnded: boolean;
}

/**
 * The group panel's data, from the workspace. With the dev `multiSubGroup` flag on, the viewer reads
 * as seated on every cohort (up to two), so the multi-membership layout can be previewed on real rows.
 */
export function groupSessionView(ws: SessionWorkspace, seam: DevSeamState | null): GroupSessionData {
	const multi = seam?.multiSubGroup ?? false;
	return {
		subGroups: ws.cohorts.map((c, i) => ({
			id: c.id,
			name: c.name,
			seatsLabel: c.seats.sentence,
			nextLabel: c.nextStartsAt ? sittingLabel(c.nextStartsAt) : null,
			overlapping: c.overlapping,
			joined: multi ? c.joined || i < 2 : c.joined,
		})),
		vote: ws.vote,
		presetEnded: ws.presetEnded,
	};
}
// #endregion

// #region Reactive helper
export { readDevSeam, subscribeDevSeam };
export type { DevSeamState };
// #endregion
