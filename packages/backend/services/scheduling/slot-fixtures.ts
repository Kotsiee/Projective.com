import type {
	BookableSlot,
	OpenBand,
	PublicCallOffer,
	RailDay,
	SchedulePage,
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
} from "@projective/types/scheduling";
import { addDaysLocal, DAY, hash, localSlot, MIN, NOW, startOfDayLocal } from "./derive.ts";

/**
 * slot fixtures — the deterministic {@link SlotGrid} behind the date rail and the slot picker.
 *
 * It is the fixture stand-in for `scheduling.availability_rules` (`kind = 'call_window'`) filtered
 * through `scheduling.fn_slot_is_free()`, and it is built from the SAME {@link SchedulePage} the
 * public schedule surface renders — not from a parallel corpus. That matters: a buyer who reads
 * "Tue 14:00" on the listing's calendar and then opens the Book modal must be offered Tue 14:00. Two
 * derivations of one provider's availability is exactly how those two views come to disagree.
 *
 * # The two zones
 *
 * Windows are evaluated in the PROVIDER's zone, because that is the zone their rules are written in
 * (`availability_rules.start_minute` is minutes from LOCAL midnight). Days are bucketed in the
 * VIEWER's zone, because that is the calendar the buyer is picking from. Both are correct at once
 * only because every instant in the grid is absolute epoch ms — the conversion is a formatting
 * concern, not an arithmetic one, and nothing here ever ships a wall-clock string.
 *
 * Deterministic throughout: a fixed reference clock ({@link NOW}), an unsigned hash, no RNG. SSR ==
 * the island refetch, and a resume replays byte-identically.
 */

// #region Booking rules
/**
 * The provider's booking guards, derived per subject.
 *
 * These mirror `scheduling.call_settings` — minimum notice, the booking horizon, and the burnout
 * buffers either side of every booking. The live path reads the real row; the shape is identical, so
 * the grid builder below is unchanged when it does.
 */
interface BookingRules {
	minNoticeMinutes: number;
	maxAdvanceDays: number;
	bufferBeforeMinutes: number;
	bufferAfterMinutes: number;
	durationMinutes: number;
}

/** Deterministic booking guards for a subject. */
function rulesFor(subjectId: string, durationMinutes: number): BookingRules {
	const h = hash(`rules:${subjectId}`);
	return {
		// 4h · 12h · 24h. Never 0: a slot bookable one minute from now is a slot the provider finds out
		// about after it has started, which is the failure the notice floor exists to prevent.
		minNoticeMinutes: [4 * 60, 12 * 60, 24 * 60][h % 3],
		maxAdvanceDays: 60,
		bufferBeforeMinutes: (h >>> 3) % 2 === 0 ? 0 : 15,
		bufferAfterMinutes: 15,
		durationMinutes,
	};
}
// #endregion

// #region Call windows
/**
 * The provider's bookable bands for a given weekday, as `[startMinute, endMinute)` in THEIR zone.
 *
 * Reads the schedule's own `call_window` rules and falls back to nothing when it has none. The
 * fallback is deliberately empty rather than "use working hours": `availability_kind` exists
 * precisely because "I am at my desk" and "interrupt me" are different claims (Decision #56), and a
 * builder that quietly treated the broad band as bookable would publish a provider's whole working
 * week as open for strangers to book into.
 */
function callWindows(page: SchedulePage, weekday: number): Array<[number, number]> {
	return page.availability.rules
		.filter((r) => r.weekday === weekday && r.kind === "call_window")
		.map((r) => [r.startMinute, r.endMinute] as [number, number])
		.sort((a, b) => a[0] - b[0]);
}

/** Whether an instant falls inside one of the schedule's blackout spans. */
function inBlackout(page: SchedulePage, start: number, end: number): boolean {
	return page.availability.blackouts.some((b) => start < b.end && end > b.start);
}
// #endregion

// #region Grid
/** Everything the builder needs that is not on the schedule page itself. */
export interface SlotGridInput {
	purpose: SlotPurpose;
	subjectId: string;
	page: SchedulePage;
	/** The block size — `1` everywhere except a set-session package. */
	sessionCount: number;
	/** Each slot's length. Provider-set; never buyer-chosen. */
	durationMinutes: number;
	/** Cohort capacity per occurrence, or `null` for a 1-on-1 grid. */
	seatsPerSession: number | null;
	/** The discovery-call offer, when the grid is a call handshake. */
	callOffer?: PublicCallOffer;
	/**
	 * Thin the grid out, or close it entirely — the developer availability axis.
	 *
	 * `sparse` keeps one weekday's windows so the picker's realistic worst case (a fortnight with one
	 * open day) is reachable; `none` closes the grid so the "this provider is not taking bookings"
	 * branch is reachable without editing a fixture.
	 */
	density?: "open" | "sparse" | "none";
	/** The instant the grid is evaluated at. Injected so the fixture clock and a live clock agree. */
	now?: number;
}

/**
 * Build the slot grid for a subject.
 *
 * The walk is over PROVIDER-local days (windows are provider-local) but the output is bucketed into
 * VIEWER-local days, so the two calendars are reconciled exactly once, here, and no consumer has to
 * think about it again.
 */
export function buildSlotGrid(query: SlotQuery, input: SlotGridInput): SlotGrid {
	const { page, purpose, subjectId, sessionCount, durationMinutes, seatsPerSession } = input;
	const now = input.now ?? NOW;
	const providerTz = page.timezone;
	const viewerTz = query.timezone || providerTz;
	const rules = rulesFor(subjectId, durationMinutes);
	const density = input.density ?? "open";

	const noticeFloor = now + rules.minNoticeMinutes * MIN;
	const horizon = now + rules.maxAdvanceDays * DAY;

	// The rail starts at the requested day or at the notice floor, whichever is later — a rail that can
	// page back to yesterday offers times that were never bookable and cost the reader a click to learn it.
	const requestedFrom = query.from ?? noticeFloor;
	const railFrom = Math.max(requestedFrom, zonedMidnight(noticeFloor, viewerTz));
	const dayCount = query.days;

	const closed = density === "none" || !page.viewerCanBook;
	const closedReason = density === "none"
		? "This provider is not taking bookings at the moment."
		: !page.viewerCanBook
		? "Bookings for this listing are not open yet."
		: null;

	// Build viewer-local days first: they are the rail, and they define the buckets everything lands in.
	const days: RailDay[] = [];
	const slots: Record<string, BookableSlot[]> = {};
	const bands: Record<string, OpenBand[]> = {};
	const todayKey = dayKeyInZone(now, viewerTz);

	// `addDaysInZone`, never `railFrom + i * DAY`. A calendar day is not always 24 hours: on a fall-back
	// date it is 25, so a fixed step lands back inside the SAME day and the rail emits it twice — a
	// duplicate key that collides in `slots` and costs the window its last day. (Spring-forward survives
	// the naive version, which is exactly why it ships unnoticed.) Pinned by `booking_test.ts`.
	const railStart = zonedMidnight(railFrom, viewerTz);
	for (let i = 0; i < dayCount; i++) {
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

	if (!closed) {
		/*
		 * Walk provider-local days across a window one day WIDER on each side than the rail.
		 *
		 * The padding is load-bearing rather than defensive: a provider in Tokyo and a viewer in Los
		 * Angeles are 16–17 hours apart, so the viewer's first rail day begins mid-afternoon on the
		 * provider's PREVIOUS day and their last ends on the provider's NEXT one. Walking only the rail's
		 * own dates would silently drop the first and last few hours of offerable time — which reads to
		 * the buyer as the provider simply not working then.
		 */
		const firstProviderDay = startOfDayLocal(addDaysInZone(railStart, -1, viewerTz), providerTz);
		for (let i = 0; i < dayCount + 2; i++) {
			const providerDay = addDaysLocal(firstProviderDay, i, providerTz);
			const pp = zonedParts(providerDay, providerTz);
			const weekday = pp.weekday;
			if (density === "sparse" && weekday !== 3) continue;

			for (const [openMin, closeMin] of callWindows(page, weekday)) {
				/*
				 * The window as an open BAND, for the custom-start control — cut around the blackouts, split
				 * across the viewer's midnight if it straddles one, and bucketed into the viewer's day like
				 * the slots. Only the shape is published (the same shape the public schedule already draws);
				 * which minutes of it are held stays on the slots.
				 */
				const { start: bandStart } = localSlot(
					providerDay,
					openMin,
					closeMin - openMin,
					providerTz,
				);
				const bandEnd = bandStart + (closeMin - openMin) * MIN;
				for (const band of openBands(page, bandStart, bandEnd)) {
					for (const piece of splitAtViewerMidnight(band, viewerTz)) {
						if (piece.startsAt >= horizon) continue;
						const key = dayKeyInZone(piece.startsAt, viewerTz);
						if (!days.some((d) => d.key === key)) continue;
						(bands[key] ??= []).push(piece);
					}
				}

				const step = durationMinutes + rules.bufferBeforeMinutes + rules.bufferAfterMinutes;
				for (let m = openMin; m + durationMinutes <= closeMin; m += step) {
					const { start, end } = localSlot(providerDay, m, durationMinutes, providerTz);
					if (start >= horizon) continue;

					const key = dayKeyInZone(start, viewerTz);
					const bucket = slots[key];
					// Only keep what the rail can actually show — the padding days exist to catch spill-over
					// into the rail, not to extend it.
					const day = days.find((d) => d.key === key);
					if (!day) continue;

					const slot = resolveSlot({
						subjectId,
						start,
						end,
						now,
						noticeFloor,
						page,
						seatsPerSession,
					});
					if (bucket) bucket.push(slot);
					else slots[key] = [slot];

					day.totalCount++;
					if (slot.available) day.openCount++;
				}
			}
		}
		for (const key of Object.keys(slots)) slots[key].sort((a, b) => a.startsAt - b.startsAt);
		for (const key of Object.keys(bands)) bands[key].sort((a, b) => a.startsAt - b.startsAt);
	}

	return {
		purpose,
		subjectId,
		providerTimezone: providerTz,
		viewerTimezone: viewerTz,
		durationMinutes,
		sessionCount,
		days,
		slots,
		bands,
		bookableFrom: noticeFloor,
		windowStart: zonedMidnight(noticeFloor, viewerTz),
		windowEnd: horizon,
		closed,
		closedReason,
	};
}

/**
 * A call window as open bands — the window minus every blackout that intersects it.
 *
 * A blackout in the middle of a window leaves TWO bands, one either side, and a blackout covering
 * the window leaves none: what remains is exactly the time a custom start may fall in, which is
 * what the picker's pre-flight check and the write's re-walk both measure against.
 */
function openBands(page: SchedulePage, start: number, end: number): OpenBand[] {
	let pieces: OpenBand[] = [{ startsAt: start, endsAt: end }];
	for (const b of page.availability.blackouts) {
		const next: OpenBand[] = [];
		for (const piece of pieces) {
			if (b.end <= piece.startsAt || b.start >= piece.endsAt) {
				next.push(piece);
				continue;
			}
			if (b.start > piece.startsAt) next.push({ startsAt: piece.startsAt, endsAt: b.start });
			if (b.end < piece.endsAt) next.push({ startsAt: b.end, endsAt: piece.endsAt });
		}
		pieces = next;
	}
	return pieces.filter((p) => p.endsAt > p.startsAt);
}

/**
 * Split a band at the viewer's local midnight, so each piece sits in exactly one rail day.
 *
 * A provider's evening window in Tokyo is a viewer's morning in Los Angeles and may cross the
 * viewer's midnight in between; a band bucketed by its START alone would then belong to a day it
 * mostly is not in, and the custom-start check for the day it spills into would find nothing.
 */
function splitAtViewerMidnight(band: OpenBand, viewerTz: string): OpenBand[] {
	const pieces: OpenBand[] = [];
	let cursor = band.startsAt;
	// Bounded: a band is at most a day long, so this runs at most twice.
	for (let guard = 0; guard < 3 && cursor < band.endsAt; guard++) {
		const nextMidnight = addDaysInZone(cursor, 1, viewerTz);
		const end = Math.min(band.endsAt, nextMidnight);
		pieces.push({ startsAt: cursor, endsAt: end });
		cursor = end;
	}
	return pieces;
}

/**
 * Resolve a CUSTOM start — a time the cadence did not land on — against the same rules the grid was
 * drawn with, and answer the slot it would occupy or why it cannot.
 *
 * It re-walks the day rather than trusting the caller: the start plus the duration must fit an open
 * band, clear the notice floor and the horizon, and — with the provider's PRIVATE buffers either side
 * of it — not overlap a slot somebody already holds. The client's pre-flight (`customStartRefusal`
 * in the SSOT) checks the public half of that; this is the whole of it, and it is the only thing that
 * can say "yes".
 */
export function resolveCustomStart(
	query: SlotQuery,
	input: SlotGridInput,
	startsAt: number,
): { slot: BookableSlot } | { reason: SlotUnavailableReason } {
	const grid = buildSlotGrid(query, input);
	if (grid.closed) return { reason: "calls_not_offered" };
	const now = input.now ?? NOW;
	const rules = rulesFor(input.subjectId, input.durationMinutes);
	const endsAt = startsAt + input.durationMinutes * MIN;

	if (startsAt < now) return { reason: "past" };
	if (grid.bookableFrom !== undefined && startsAt < grid.bookableFrom) {
		return { reason: "inside_minimum_notice" };
	}
	if (startsAt >= grid.windowEnd) return { reason: "beyond_booking_horizon" };

	const key = dayKeyInZone(startsAt, grid.viewerTimezone);
	const inBand = (grid.bands[key] ?? []).some((b) => startsAt >= b.startsAt && endsAt <= b.endsAt);
	if (!inBand) return { reason: "outside_call_window" };
	if (inBlackout(input.page, startsAt, endsAt)) return { reason: "blackout" };

	// The buffers are applied to the REQUEST, so a custom start cannot be wedged into the dead time the
	// provider reserved either side of a booking somebody else holds.
	const guardedStart = startsAt - rules.bufferBeforeMinutes * MIN;
	const guardedEnd = endsAt + rules.bufferAfterMinutes * MIN;
	for (const held of grid.slots[key] ?? []) {
		if (held.available || held.reason !== "taken") continue;
		if (guardedStart < held.endsAt && guardedEnd > held.startsAt) return { reason: "taken" };
	}

	return {
		slot: {
			id: `custom-${startsAt}`,
			startsAt,
			endsAt,
			available: true,
			reason: null,
			seatsRemaining: null,
		},
	};
}

/**
 * Decide one slot's availability and, for a cohort, its remaining seats.
 *
 * The order of the checks is the order of the truth: something in the past is not "taken", and
 * something inside a blackout is not "past". A picker that collapsed all three into `available:
 * false` would tell a buyer the provider never works Thursdays when in fact they are on holiday.
 */
function resolveSlot(args: {
	subjectId: string;
	start: number;
	end: number;
	now: number;
	noticeFloor: number;
	page: SchedulePage;
	seatsPerSession: number | null;
}): BookableSlot {
	const { subjectId, start, end, now, noticeFloor, page, seatsPerSession } = args;
	const id = `slot-${start}`;

	if (start < now) {
		return {
			id,
			startsAt: start,
			endsAt: end,
			available: false,
			reason: "past",
			seatsRemaining: null,
		};
	}
	if (start < noticeFloor) {
		return {
			id,
			startsAt: start,
			endsAt: end,
			available: false,
			reason: "inside_minimum_notice",
			seatsRemaining: null,
		};
	}
	if (inBlackout(page, start, end)) {
		return {
			id,
			startsAt: start,
			endsAt: end,
			available: false,
			reason: "blackout",
			seatsRemaining: null,
		};
	}

	const h = hash(`${subjectId}:${start}`);

	if (seatsPerSession !== null) {
		// A cohort occurrence is never binary: it fills. Seats remaining is what the picker prints, and
		// zero is the one value that makes the slot unbookable.
		const taken = h % (seatsPerSession + 1);
		const remaining = seatsPerSession - taken;
		return {
			id,
			startsAt: start,
			endsAt: end,
			available: remaining > 0,
			reason: remaining > 0 ? null : "slot_unavailable",
			seatsRemaining: remaining,
		};
	}

	// ~1 in 3 already booked. A grid where everything is free reads as a provider nobody hires, and it
	// never exercises the "offered but spoken for" state the rail's open-vs-total split exists to show.
	const taken = h % 3 === 0;
	return {
		id,
		startsAt: start,
		endsAt: end,
		available: !taken,
		reason: taken ? "taken" : null,
		seatsRemaining: null,
	};
}
// #endregion
