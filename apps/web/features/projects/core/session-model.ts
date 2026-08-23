import {
	type DevSeamState,
	type DevSessionBookingStatus,
	readDevSeam,
	subscribeDevSeam,
} from "@web/utils/dev-seam.ts";
import type { ProjectDetail, ProjectFormat, ProjectParty } from "../types/projects-types.ts";

/**
 * session-model — the pure, DOM-free model behind the three service delivery archetypes (task §2/§3).
 * A **standard project** is stage-based (the existing behaviour); a **normal (1-1) session** and a
 * **group session** are session services whose channel structure, sidebar layout, and channel-header
 * tab set differ.
 *
 * Like {@link submission-access}, it resolves the effective archetype by layering the DEV-only Context
 * Switcher override (`serviceType`) on top of the real SSR-resolved baseline (the engagement `format`),
 * and reads that override exclusively through the shipping-safe {@link readDevSeam}/{@link subscribeDevSeam}
 * seam — so in production the seam is always `null`, every derivation degrades to the real values, and no
 * build-excluded devtools code is imported. Every value is derived deterministically (a small slug hash,
 * no RNG, no `Date`) so SSR and the hydrated island render identically with no drift.
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

/**
 * Resolve the effective {@link SessionKind}. Without an override it is the real baseline — a `session`
 * format is a 1-1 session, anything else is a standard project. With an override the dev `serviceType`
 * wins: `normal_session` → `normal`, `group_session` → `group`, `standard_project` → `none`.
 */
export function resolveSessionKind(
	format: ProjectFormat,
	seam: DevSeamState | null,
): SessionKind {
	if (seam) {
		switch (seam.serviceType) {
			case "normal_session":
				return "normal";
			case "group_session":
				return "group";
			default:
				return "none";
		}
	}
	return format === "session" ? "normal" : "none";
}

/**
 * Re-resolve the {@link SessionKind} live in an island from the SSR baseline + the active override — the
 * seam's `serviceType` wins when present, else the server-painted baseline stands. Lets an island track
 * the Context Switcher without threading the engagement `format`.
 */
export function liveSessionKind(baseline: SessionKind, seam: DevSeamState | null): SessionKind {
	if (!seam) return baseline;
	switch (seam.serviceType) {
		case "normal_session":
			return "normal";
		case "group_session":
			return "group";
		default:
			return "none";
	}
}
// #endregion

// #region Deterministic helpers
/** A tiny stable hash of a string → non-negative int (no RNG; SSR/resume stable). */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const TIMES = ["10:00 AM", "11:30 AM", "1:00 PM", "2:30 PM", "4:00 PM"] as const;
const RELATIVE = ["Today", "Tomorrow", "In 2 days", "In 3 days", "Next week"] as const;
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
 * Map a {@link DevSessionBookingStatus} to its badge (task §3.A). A confirmed slot reads as a settled
 * booking; a client proposal is a pending proposal awaiting the viewer; a provider proposal is a
 * reschedule the viewer initiated (awaiting the client).
 */
export function bookingBadge(status: DevSessionBookingStatus): BookingBadge {
	switch (status) {
		case "client_proposed":
			return {
				label: "Pending Proposal",
				tone: "pending",
				note: "The client proposed a time — awaiting your confirmation.",
			};
		case "freelancer_proposed":
			return {
				label: "Rescheduled",
				tone: "rescheduled",
				note: "You proposed a new time — awaiting the client.",
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
// #endregion

// #region Session data (1-1)
/** The next booked/proposed session for the upcoming-session widget. */
export interface UpcomingSession {
	/** Pre-formatted day + time (e.g. "Thu · 2:30 PM"). Deterministic — no locale/timezone drift. */
	label: string;
	/** Pre-formatted relative label (e.g. "In 2 days"). */
	relativeLabel: string;
	/** Pre-formatted duration label (e.g. "60 min"). */
	durationLabel: string;
	/** The booking-proposal state (drives {@link bookingBadge}). */
	bookingStatus: DevSessionBookingStatus;
}

/** The session counter — a package (Session N of M) or an open pay-per-session arrangement. */
export interface SessionCounter {
	/** Pay-as-you-go rather than a fixed package. */
	payPerSession: boolean;
	/** 1-based index of the upcoming session within a package (ignored when {@link payPerSession}). */
	index: number;
	/** Total sessions in the package (ignored when {@link payPerSession}). */
	total: number;
	/** Pre-formatted label ("Session 3 of 10" | "Pay-per-session"). */
	label: string;
}

/** The full 1-1 session sidebar projection. */
export interface NormalSessionData {
	upcoming: UpcomingSession;
	counter: SessionCounter;
	/** The other party in the 1-1 (the client for a provider viewer, else the provider). */
	party: ProjectParty;
}

/** Derive the 1-1 session sidebar data deterministically from the engagement + the active override. */
export function deriveNormalSession(
	detail: ProjectDetail,
	seam: DevSeamState | null,
): NormalSessionData {
	const h = hash(detail.slug);
	const bookingStatus: DevSessionBookingStatus = seam?.sessionBookingStatus ?? "confirmed";
	// `hash()` is unsigned (`>>> 0`), so every derived index MUST use the unsigned shift `>>>` — a signed
	// `>>` above 2³¹ goes negative → a negative array index → an `undefined` slot ("undefined min").
	const upcoming: UpcomingSession = {
		label: `${WEEKDAYS[h % WEEKDAYS.length]} · ${TIMES[(h >>> 3) % TIMES.length]}`,
		relativeLabel: RELATIVE[h % RELATIVE.length],
		durationLabel: `${[30, 45, 60, 90][(h >>> 5) % 4]} min`,
		bookingStatus,
	};
	// A stable pseudo-package: some engagements are pay-per-session, others a fixed block.
	const payPerSession = h % 3 === 0;
	const total = 6 + (h % 7); // 6–12
	const index = 1 + (h % total);
	const counter: SessionCounter = {
		payPerSession,
		index,
		total,
		label: payPerSession ? "Pay-per-session" : `Session ${index} of ${total}`,
	};
	const party = detail.client ?? detail.owner;
	return { upcoming, counter, party };
}
// #endregion

// #region Group session data
/** One proficiency level / breakout sub-group channel in a group session. */
export interface SubGroup {
	id: string;
	chatId: string;
	name: string;
	/** A short level/track tag shown as a pill (e.g. "Beginner", "Advanced"). */
	level: string;
	/** Whether this sub-group's live schedule overlaps another (an overlap indicator). */
	overlapping: boolean;
	/** Whether the acting viewer is a member of this sub-group. */
	joined: boolean;
	unread: boolean;
}

/** A live reschedule vote across the cohort (task §3.B). */
export interface SessionVote {
	/** The proposal being voted on (e.g. "Move Thursday's class to 4:00 PM"). */
	prompt: string;
	accepted: number;
	total: number;
}

/** The full group-session sidebar projection. */
export interface GroupSessionData {
	subGroups: SubGroup[];
	vote: SessionVote;
	/** Whether the preset group sessions have ended (gates the 1-1 continuation CTA). */
	presetEnded: boolean;
}

const LEVELS = [
	{ name: "Foundations", level: "Beginner" },
	{ name: "Core Track", level: "Intermediate" },
	{ name: "Advanced Studio", level: "Advanced" },
	{ name: "Capstone Breakout", level: "Breakout" },
] as const;

/**
 * Derive the group-session sub-groups + cohort signals deterministically. The number of sub-groups and
 * the viewer's membership vary by slug hash; when the dev `multiSubGroup` flag is on the viewer is a
 * member of several sub-groups (task §4), else only the first.
 */
export function deriveGroupSession(
	detail: ProjectDetail,
	seam: DevSeamState | null,
): GroupSessionData {
	const h = hash(detail.slug);
	const count = 3 + (h % 2); // 3–4 sub-groups
	const multi = seam?.multiSubGroup ?? false;
	const subGroups: SubGroup[] = [];
	for (let i = 0; i < count; i++) {
		const meta = LEVELS[i % LEVELS.length];
		subGroups.push({
			id: `subgroup-${i}`,
			chatId: `chan-${detail.slug}-subgroup-${i}`,
			name: meta.name,
			level: meta.level,
			overlapping: (h >>> i) % 3 === 0,
			joined: multi ? i < Math.min(count, 2 + (h % 2)) : i === 0,
			unread: detail.channels.general.some((c) => c.unread) && i === 0,
		});
	}
	const total = 8 + (h % 8); // cohort size 8–15
	const vote: SessionVote = {
		prompt: "Reschedule proposal: move the live session to a later slot",
		accepted: Math.max(1, Math.round(total * (0.5 + (h % 5) / 10))),
		total,
	};
	// A couple of cohorts have reached the end of their preset block (1-1 continuation unlocked).
	const presetEnded = h % 4 === 0;
	return { subGroups, vote, presetEnded };
}
// #endregion

// #region Reactive helper
export { readDevSeam, subscribeDevSeam };
export type { DevSeamState };
// #endregion
