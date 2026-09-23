import type {
	BookableSlot,
	OpenBand,
	RailDay,
	SlotGrid,
	SlotPurpose,
	SlotQuery,
	SlotUnavailableReason,
} from "@projective/types/scheduling";
import {
	addDaysInZone,
	dayKeyInZone,
	zonedMidnight,
	zonedParts,
	zoneOffsetMinutes,
} from "@projective/types/scheduling";

/**
 * slot-grid — the bookable {@link SlotGrid} behind the date rail and the slot picker, built from a
 * provider's REAL schedule.
 *
 * Pure: every input — the provider's bands, blackouts, busy spans, booking guards and the clock — is
 * handed in, so the same builder answers the Book modal, the discovery-call handshake, a custom start
 * and the write path's re-check, and a test can pin it without a database. The live reader
 * (`live-slots.ts`) is the only thing that fetches.
 *
 * # It agrees with the database's booking gate by construction
 *
 * A slot the grid offers is a slot `scheduling.fn_call_request_refusal` accepts, because the two apply
 * the same four rules in the same way:
 *
 *  - **inside a band** of the relevant kind, on one local weekday (a band never crosses midnight);
 *  - **after the notice floor** (`now + min_notice_minutes`) and **before the horizon**
 *    (`now + max_advance_days`);
 *  - **clear of every blackout**, compared on the RAW span — time off is an absolute boundary;
 *  - **clear of every commitment**, with the span widened by `buffer_before + buffer_after` on BOTH
 *    edges — the algebra `scheduling.fn_slot_is_free` uses, which is equivalent to padding every
 *    commitment by its own buffers without a per-row lookup.
 *
 * A grid that used a different buffer rule would offer 11:00 after a meeting ending 11:00, and the
 * database would refuse it after the buyer had typed an agenda.
 *
 * # The two zones
 *
 * Bands are evaluated in the PROVIDER's zone (they are minutes from the provider's local midnight);
 * days are bucketed in the VIEWER's zone (the calendar the buyer picks from). Every instant is
 * absolute epoch ms, so the conversion is a formatting concern and happens exactly once, here.
 */

// #region Inputs
/** One weekly band in the provider's zone: `weekday` 0 = Sunday, minutes from local midnight. */
export interface GridBand {
	weekday: number;
	startMinute: number;
	endMinute: number;
}

/** An absolute span, epoch ms, `end` exclusive. */
export interface Span {
	start: number;
	end: number;
}

/** The provider's booking guards (`scheduling.call_settings`, or the column defaults). */
export interface GridRules {
	minNoticeMinutes: number;
	maxAdvanceDays: number;
	bufferBeforeMinutes: number;
	bufferAfterMinutes: number;
}

/** A provider's schedule, as read — everything the builder needs that is not about the request. */
export interface GridSource {
	/** The provider's IANA zone. */
	timezone: string;
	/** The bands of the kind this grid books into (call windows for a call, working hours otherwise). */
	bands: GridBand[];
	blackouts: Span[];
	/** Occupied time: commitments and calls already requested or confirmed. */
	busy: Span[];
	rules: GridRules;
	/** Why the grid is closed, when it is (an unpublished schedule, calls switched off). */
	closedReason: string | null;
}

/** What is being booked. */
export interface GridRequest {
	purpose: SlotPurpose;
	subjectId: string;
	/** The block size — `1` everywhere except a set-session package. */
	sessionCount: number;
	/** Each slot's length. Provider-set; never buyer-chosen. */
	durationMinutes: number;
	/** Cohort capacity per occurrence, or `null` for a one-to-one grid. */
	seatsPerSession: number | null;
	/** The instant the grid is evaluated at. */
	now: number;
}

/** The column defaults of `scheduling.call_settings` — the guards of a schedule that set none. */
export const DEFAULT_GRID_RULES: GridRules = {
	minNoticeMinutes: 720,
	maxAdvanceDays: 60,
	bufferBeforeMinutes: 0,
	bufferAfterMinutes: 10,
};
// #endregion

// #region Time
const MIN = 60_000;
const DAY = 86_400_000;

/**
 * The instant a provider-local wall-clock minute falls at, on the local day containing `dayMidnight`.
 *
 * The same two-pass offset solve `zonedMidnight` uses, so a band starting at 02:30 on a spring-forward
 * day lands on the real instant rather than an hour off.
 */
function localInstant(dayMidnight: number, minute: number, tz: string): number {
	const p = zonedParts(dayMidnight, tz);
	const naive = Date.UTC(p.year, p.month, p.dayOfMonth, 0, minute, 0, 0);
	const firstPass = naive - zoneOffsetMinutes(dayMidnight, tz) * MIN;
	return naive - zoneOffsetMinutes(firstPass, tz) * MIN;
}

function overlaps(a: Span, b: Span): boolean {
	return a.start < b.end && a.end > b.start;
}
// #endregion

// #region One slot
/**
 * Decide one slot. The order of the checks is the order of the truth: something in the past is not
 * "taken", and something inside a blackout is not "past" — a picker that collapsed them would tell a
 * buyer the provider never works Thursdays when in fact they are on holiday.
 */
function judgeSlot(
	source: GridSource,
	request: GridRequest,
	start: number,
	end: number,
	noticeFloor: number,
	horizon: number,
): BookableSlot {
	const id = `slot-${start}`;
	const base = { id, startsAt: start, endsAt: end, seatsRemaining: null as number | null };
	if (start < request.now) return { ...base, available: false, reason: "past" };
	if (start < noticeFloor) return { ...base, available: false, reason: "inside_minimum_notice" };
	if (start > horizon) return { ...base, available: false, reason: "beyond_booking_horizon" };
	const raw = { start, end };
	if (source.blackouts.some((b) => overlaps(raw, b))) {
		return { ...base, available: false, reason: "blackout" };
	}
	const pad = (source.rules.bufferBeforeMinutes + source.rules.bufferAfterMinutes) * MIN;
	const guarded = { start: start - pad, end: end + pad };
	if (source.busy.some((b) => overlaps(guarded, b))) {
		return { ...base, available: false, reason: "taken" };
	}
	// A cohort occurrence reports its seats. No seat is held by anything this reader can see yet, so
	// every seat an open occurrence has is offered — a count, never an invented fill level.
	if (request.seatsPerSession !== null) {
		return { ...base, available: true, reason: null, seatsRemaining: request.seatsPerSession };
	}
	return { ...base, available: true, reason: null };
}
// #endregion

// #region Grid
/**
 * Build the grid for a request against a provider's schedule.
 *
 * The walk is over PROVIDER-local days (bands are provider-local) across a window one day wider on
 * each side than the rail — a provider in Tokyo and a viewer in Los Angeles are ~17 hours apart, so
 * the viewer's first rail day begins on the provider's previous day and walking only the rail's own
 * dates would silently drop offerable time at both ends.
 */
export function buildGrid(query: SlotQuery, source: GridSource, request: GridRequest): SlotGrid {
	const providerTz = source.timezone;
	const viewerTz = query.timezone || providerTz;
	const { now } = request;
	const noticeFloor = now + source.rules.minNoticeMinutes * MIN;
	const horizon = now + source.rules.maxAdvanceDays * DAY;
	const closed = source.closedReason !== null;

	// The rail starts at the requested day or the notice floor, whichever is later — a rail that pages
	// back to yesterday offers times that were never bookable.
	const requestedFrom = query.from ?? noticeFloor;
	const railStart = zonedMidnight(Math.max(requestedFrom, zonedMidnight(noticeFloor, viewerTz)), viewerTz);
	const todayKey = dayKeyInZone(now, viewerTz);

	const days: RailDay[] = [];
	const slots: Record<string, BookableSlot[]> = {};
	const bands: Record<string, OpenBand[]> = {};
	for (let i = 0; i < query.days; i++) {
		// `addDaysInZone`, never `+ i * DAY`: a fall-back day is 25 hours and a fixed step lands inside
		// the same day twice.
		const dayStart = addDaysInZone(railStart, i, viewerTz);
		const key = dayKeyInZone(dayStart, viewerTz);
		const p = zonedParts(dayStart, viewerTz);
		days.push({
			key,
			startsAt: dayStart,
			dayOfMonth: p.dayOfMonth,
			weekday: p.weekday,
			month: p.month,
			year: p.year,
			isToday: key === todayKey,
			openCount: 0,
			totalCount: 0,
		});
	}
	const dayByKey = new Map(days.map((d) => [d.key, d]));

	if (!closed) {
		const firstProviderDay = zonedMidnight(addDaysInZone(railStart, -1, viewerTz), providerTz);
		const step = request.durationMinutes + source.rules.bufferBeforeMinutes +
			source.rules.bufferAfterMinutes;
		for (let i = 0; i < query.days + 2; i++) {
			const providerDay = addDaysInZone(firstProviderDay, i, providerTz);
			const weekday = zonedParts(providerDay, providerTz).weekday;
			const dayBands = source.bands
				.filter((b) => b.weekday === weekday)
				.sort((a, b) => a.startMinute - b.startMinute);

			for (const band of dayBands) {
				// The band as open time for the custom-start control: cut around blackouts, split at the
				// viewer's midnight, bucketed into the viewer's day. Only the shape is published — which
				// minutes are held stays on the slots.
				const bandStart = localInstant(providerDay, band.startMinute, providerTz);
				const bandEnd = localInstant(providerDay, band.endMinute, providerTz);
				for (const piece of openPieces({ start: bandStart, end: bandEnd }, source.blackouts)) {
					for (const part of splitAtMidnight(piece, viewerTz)) {
						if (part.startsAt > horizon) continue;
						const key = dayKeyInZone(part.startsAt, viewerTz);
						if (!dayByKey.has(key)) continue;
						(bands[key] ??= []).push(part);
					}
				}

				for (
					let m = band.startMinute;
					m + request.durationMinutes <= band.endMinute;
					m += step
				) {
					const start = localInstant(providerDay, m, providerTz);
					const end = start + request.durationMinutes * MIN;
					if (start > horizon) continue;
					const key = dayKeyInZone(start, viewerTz);
					const day = dayByKey.get(key);
					if (!day) continue;
					const slot = judgeSlot(source, request, start, end, noticeFloor, horizon);
					(slots[key] ??= []).push(slot);
					day.totalCount++;
					if (slot.available) day.openCount++;
				}
			}
		}
		for (const key of Object.keys(slots)) slots[key].sort((a, b) => a.startsAt - b.startsAt);
		for (const key of Object.keys(bands)) bands[key].sort((a, b) => a.startsAt - b.startsAt);
	}

	return {
		purpose: request.purpose,
		subjectId: request.subjectId,
		providerTimezone: providerTz,
		viewerTimezone: viewerTz,
		durationMinutes: request.durationMinutes,
		sessionCount: request.sessionCount,
		days,
		slots,
		bands,
		bookableFrom: noticeFloor,
		windowStart: zonedMidnight(noticeFloor, viewerTz),
		windowEnd: horizon,
		closed,
		closedReason: source.closedReason,
	};
}

/** A band minus every blackout that intersects it — what remains is time a custom start may use. */
function openPieces(band: Span, blackouts: Span[]): Span[] {
	let pieces = [band];
	for (const b of blackouts) {
		const next: Span[] = [];
		for (const piece of pieces) {
			if (!overlaps(piece, b)) {
				next.push(piece);
				continue;
			}
			if (b.start > piece.start) next.push({ start: piece.start, end: b.start });
			if (b.end < piece.end) next.push({ start: b.end, end: piece.end });
		}
		pieces = next;
	}
	return pieces.filter((p) => p.end > p.start);
}

/** Split a span at the viewer's local midnight so each piece sits in exactly one rail day. */
function splitAtMidnight(span: Span, viewerTz: string): OpenBand[] {
	const out: OpenBand[] = [];
	let cursor = span.start;
	for (let guard = 0; guard < 3 && cursor < span.end; guard++) {
		const nextMidnight = addDaysInZone(cursor, 1, viewerTz);
		const end = Math.min(span.end, nextMidnight);
		out.push({ startsAt: cursor, endsAt: end });
		cursor = end;
	}
	return out;
}
// #endregion

// #region A custom start
/**
 * Judge a CUSTOM start — a time the cadence did not land on — by the same rules the grid applies:
 * inside one open band, after the notice floor, before the horizon, clear of blackouts, and clear of
 * every commitment with the buffers applied. It is the grid's own "yes"; the database gate re-checks
 * the same four rules on the write.
 */
export function judgeCustomStart(
	query: SlotQuery,
	source: GridSource,
	request: GridRequest,
	startsAt: number,
): { slot: BookableSlot } | { reason: SlotUnavailableReason } {
	if (source.closedReason !== null) return { reason: "calls_not_offered" };
	const grid = buildGrid(query, source, request);
	const endsAt = startsAt + request.durationMinutes * MIN;
	const key = dayKeyInZone(startsAt, grid.viewerTimezone);
	const inBand = (grid.bands[key] ?? []).some((b) => startsAt >= b.startsAt && endsAt <= b.endsAt);
	const slot = judgeSlot(
		source,
		request,
		startsAt,
		endsAt,
		grid.bookableFrom ?? request.now,
		grid.windowEnd,
	);
	// Past, notice and horizon read before the band test: "too soon" is the truer answer for a time the
	// provider would otherwise take.
	if (!slot.available && slot.reason !== "taken" && slot.reason !== "blackout") {
		return { reason: slot.reason ?? "slot_unavailable" };
	}
	if (!inBand) return { reason: "outside_call_window" };
	if (!slot.available) return { reason: slot.reason ?? "slot_unavailable" };
	return { slot: { ...slot, id: `custom-${startsAt}` } };
}
// #endregion
