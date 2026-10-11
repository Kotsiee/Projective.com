import { type FundingState, type FundingStatus, formatMoney } from "@projective/types/finance";
import {
	type CohortOffer,
	type CohortView,
	type CurriculumModule,
	cancelOutcomeAt,
	DEFAULT_SESSION_TERMS,
	type SessionJoin,
	type SessionSitting,
	type SessionTerms,
	type SessionWorkspace,
	seatCount,
	sittingPhase,
} from "@projective/types/projects";

/**
 * workspace-model — the pure mapping from the two session reads in
 * `00001155_functions_projects_sessions.sql` (`get_session_workspace`, `get_cohort_offer`) onto the
 * Zod SSOT, and the one place a seat's funding state is decided (Decision #171). No I/O and an
 * injected `now`, so every branch is pinned by `workspace-model.test.ts`.
 */

// #region Raw rows (the SQL jsonb, as written by the functions)
interface RawLesson {
	id: string;
	title: string;
	duration_minutes: number | null;
	done?: boolean | null;
}
interface RawModule {
	id: string;
	title: string;
	summary: string | null;
	starts_at: string | null;
	lessons: RawLesson[] | null;
}
interface RawSitting {
	id: string;
	cohort_id?: string;
	title: string;
	starts_at: string;
	ends_at: string;
	status?: string;
}
interface RawEscrow {
	status: string;
	amount_minor: number;
	currency: string;
	claim_open: boolean;
}

/** `projects.get_session_workspace`'s answer. */
export interface RawWorkspace {
	project_id: string;
	slug: string;
	session_kind: string;
	role: "host" | "attendee" | "prospect";
	seat_price_minor: number | null;
	currency: string;
	terms: Partial<Record<
		"seat_hold_minutes" | "join_lead_minutes" | "presence_minutes" | "cancel_notice_hours" | "payout_hours",
		number
	>>;
	cohorts: {
		id: string;
		name: string;
		status: CohortView["status"];
		max_seats: number;
		taken: number;
		joined: boolean;
		next_start: string | null;
		next_end: string | null;
	}[];
	sittings: RawSitting[];
	membership: {
		id: string;
		cohort_id: string;
		status: "active" | "cancelled" | "completed";
		seats: number;
		escrow: RawEscrow | null;
		first_start: string | null;
	} | null;
	hold: { id: string; seats: number; expires_at: string } | null;
	host_escrows: { held_minor: number; held_count: number; released_minor: number; currency: string | null } | null;
	curriculum: RawModule[];
	join: {
		event_id?: string;
		role?: "host" | "attendee";
		state: SessionJoin["state"] | "not_party";
		opens_at?: string;
		closes_at?: string;
		url?: string | null;
	} | null;
	reschedule: {
		sitting_title: string;
		mode: "counterparty" | "vote";
		status: string;
		opened_by_host: boolean;
		votes: number;
		voters: number;
	} | null;
}

/** `projects.get_cohort_offer`'s answer. */
export interface RawCohortOffer {
	cohort_id: string;
	name: string;
	max_seats: number;
	taken: number;
	remaining: number;
	first_start: string | null;
	sittings: RawSitting[] | null;
	curriculum: RawModule[] | null;
}
// #endregion

// #region Helpers
function isoOf(value: string | null | undefined): string | null {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function termsOf(raw: RawWorkspace["terms"] | undefined): SessionTerms {
	const t = raw ?? {};
	return {
		seatHoldMinutes: t.seat_hold_minutes ?? DEFAULT_SESSION_TERMS.seatHoldMinutes,
		joinLeadMinutes: t.join_lead_minutes ?? DEFAULT_SESSION_TERMS.joinLeadMinutes,
		presenceMinutes: t.presence_minutes ?? DEFAULT_SESSION_TERMS.presenceMinutes,
		cancelNoticeHours: t.cancel_notice_hours ?? DEFAULT_SESSION_TERMS.cancelNoticeHours,
		payoutHours: t.payout_hours ?? DEFAULT_SESSION_TERMS.payoutHours,
	};
}

/** Curriculum modules, with the viewer's progress (`done: null` when they have none to keep). */
export function curriculumOf(raw: readonly RawModule[] | null | undefined): CurriculumModule[] {
	return (raw ?? []).slice(0, 100).map((m) => ({
		id: m.id,
		title: m.title.slice(0, 160),
		summary: (m.summary ?? "").slice(0, 2000),
		startsAt: isoOf(m.starts_at),
		lessons: (m.lessons ?? []).slice(0, 100).map((l) => ({
			id: l.id,
			title: l.title.slice(0, 160),
			durationMinutes: l.duration_minutes ?? null,
			done: typeof l.done === "boolean" ? l.done : null,
		})),
	}));
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
	return a.start < b.end && b.start < a.end;
}
// #endregion

// #region Funding
/** What the session line of FundingStatus needs beyond a state. */
interface SeatFundingInput {
	state: FundingState;
	amountMinor: number | null;
	currency: string;
	nextAction: FundingStatus["nextAction"];
}

function fundingOf(f: SeatFundingInput): FundingStatus {
	return {
		state: f.state,
		amountMinor: f.amountMinor,
		currency: f.currency,
		amountLabel: f.amountMinor === null ? null : formatMoney(f.amountMinor, f.currency),
		// A session is joined, never "started", so no seat ever offers Start work.
		canStart: false,
		nextAction: f.nextAction,
		reason: null,
		autoFunded: false,
		invoiceOn: null,
	};
}

/** Where a held seat escrow stands against the sittings it pays for. */
function heldState(sittings: readonly SessionSitting[]): FundingState {
	if (sittings.length > 0 && sittings.every((s) => s.phase === "ended" || s.phase === "cancelled")) {
		return "in_review"; // every sitting is over: the negative-consent window is running
	}
	return sittings.some((s) => s.phase === "live" || s.phase === "ended") ? "in_progress" : "funded";
}

/**
 * The seat's funding, as the session funding line reads it:
 * a live hold → `needs_funding` ("Seat reserved, pay to confirm"); a held escrow → `funded` before the
 * first sitting ("Confirmed, join link opens 10 min before"), `in_progress` once sittings run, and
 * `in_review` after the last one ("Releases 24h after the session"); then `released` / `refunded`.
 * The host sees the engagement's held total on the same scale.
 */
export function sessionFunding(raw: RawWorkspace, sittings: readonly SessionSitting[]): FundingStatus | null {
	const currency = (raw.currency || "USD").toUpperCase();
	if (raw.role === "host") {
		const h = raw.host_escrows;
		if (!h) return null;
		if (h.held_count > 0) {
			return fundingOf({ state: heldState(sittings), amountMinor: h.held_minor, currency, nextAction: "none" });
		}
		return h.released_minor > 0
			? fundingOf({ state: "released", amountMinor: h.released_minor, currency, nextAction: "none" })
			: null;
	}
	const m = raw.membership;
	if (m?.escrow && m.status !== "cancelled") {
		const amount = m.escrow.amount_minor;
		const cur = (m.escrow.currency || currency).toUpperCase();
		if (m.escrow.status === "released") {
			return fundingOf({ state: "released", amountMinor: amount, currency: cur, nextAction: "none" });
		}
		if (m.escrow.status === "refunded") {
			return fundingOf({ state: "refunded", amountMinor: amount, currency: cur, nextAction: "none" });
		}
		return fundingOf({ state: heldState(sittings), amountMinor: amount, currency: cur, nextAction: "none" });
	}
	if (m?.escrow?.status === "refunded") {
		return fundingOf({ state: "refunded", amountMinor: m.escrow.amount_minor, currency, nextAction: "none" });
	}
	if (raw.hold) {
		const amount = raw.seat_price_minor === null ? null : raw.seat_price_minor * raw.hold.seats;
		return fundingOf({ state: "needs_funding", amountMinor: amount, currency, nextAction: "fund" });
	}
	return null;
}
// #endregion

// #region Workspace
/** Map the workspace read for one viewer at `now`. */
export function toSessionWorkspace(raw: RawWorkspace, now: number): SessionWorkspace {
	const terms = termsOf(raw.terms);

	// Sittings, indexed within their own cohort ("Session 3 of 10").
	const byCohort = new Map<string, RawSitting[]>();
	for (const s of raw.sittings ?? []) {
		const key = s.cohort_id ?? "";
		byCohort.set(key, [...(byCohort.get(key) ?? []), s]);
	}
	const sittings: SessionSitting[] = [];
	for (const list of byCohort.values()) {
		list.forEach((s, i) => {
			const startsAt = isoOf(s.starts_at);
			const endsAt = isoOf(s.ends_at);
			if (!startsAt || !endsAt) return;
			sittings.push({
				id: s.id,
				title: s.title.slice(0, 200),
				startsAt,
				endsAt,
				phase: sittingPhase(
					{ startsAt, endsAt, cancelled: (s.status ?? "").startsWith("cancelled") },
					now,
				),
				index: i + 1,
				total: list.length,
			});
		});
	}
	sittings.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

	const next = sittings.find((s) => s.phase === "live") ??
		sittings.find((s) => s.phase === "upcoming") ?? null;

	const spans = raw.cohorts.map((c) => ({
		id: c.id,
		span: c.next_start && c.next_end
			? { start: Date.parse(c.next_start), end: Date.parse(c.next_end) }
			: null,
	}));
	const cohorts: CohortView[] = raw.cohorts.map((c) => {
		const own = spans.find((s) => s.id === c.id)?.span ?? null;
		return {
			id: c.id,
			name: c.name.slice(0, 160),
			status: c.status,
			seats: seatCount(c.max_seats, c.taken),
			joined: c.joined,
			nextStartsAt: isoOf(c.next_start),
			overlapping: !!own && spans.some((s) => s.id !== c.id && !!s.span && overlaps(own, s.span)),
		};
	});

	const j = raw.join;
	const join: SessionJoin | null = j && j.state !== "not_party" && j.event_id && j.role && j.opens_at &&
			j.closes_at
		? {
			eventId: j.event_id,
			role: j.role,
			state: j.state,
			opensAt: isoOf(j.opens_at) ?? j.opens_at,
			closesAt: isoOf(j.closes_at) ?? j.closes_at,
			url: j.state === "open" && j.url ? j.url : null,
		}
		: null;

	const m = raw.membership;
	const r = raw.reschedule;
	return {
		projectId: raw.project_id,
		slug: raw.slug,
		kind: raw.session_kind === "group" ? "group" : "normal",
		role: raw.role,
		terms,
		cohorts,
		next,
		join,
		curriculum: curriculumOf(raw.curriculum),
		membership: m
			? {
				id: m.id,
				cohortId: m.cohort_id,
				status: m.status,
				seats: m.seats,
				cancelOutcome: m.status === "active"
					? cancelOutcomeAt(isoOf(m.first_start), now, terms.cancelNoticeHours)
					: null,
				claimOpen: !!m.escrow?.claim_open,
			}
			: null,
		funding: sessionFunding(raw, sittings),
		vote: r && r.mode === "vote" && r.status === "voting"
			? { prompt: `Reschedule proposal: ${r.sitting_title}`.slice(0, 200), accepted: r.votes, total: r.voters }
			: null,
		proposal: r && r.mode === "counterparty" && r.status === "awaiting_counterparty"
			? (r.opened_by_host ? "host" : "attendee")
			: null,
		presetEnded: sittings.length > 0 && sittings.every((s) => s.phase === "ended" || s.phase === "cancelled"),
	};
}
// #endregion

// #region The listing's cohort
/** Map `get_cohort_offer` onto the offer the entity view and the Reserve seat flow read. */
export function toCohortOffer(raw: RawCohortOffer | null): CohortOffer | null {
	if (!raw) return null;
	return {
		cohortId: raw.cohort_id,
		name: raw.name.slice(0, 160),
		seats: seatCount(raw.max_seats, raw.taken),
		firstStartsAt: isoOf(raw.first_start),
		sittings: (raw.sittings ?? []).flatMap((s) => {
			const startsAt = isoOf(s.starts_at);
			const endsAt = isoOf(s.ends_at);
			return startsAt && endsAt ? [{ id: s.id, title: s.title.slice(0, 200), startsAt, endsAt }] : [];
		}).slice(0, 200),
		curriculum: curriculumOf(raw.curriculum),
	};
}
// #endregion
