import type {
	AvailabilityRule,
	CalendarEvent,
	SchedulePage,
	SchedulingSim,
	SchedulingViewer,
} from "@projective/types/scheduling";
import { ANONYMOUS_VIEWER } from "@projective/types/scheduling";
import { findProfile } from "../profile/profile-fixtures.ts";
import {
	addDaysLocal,
	externalSourceFor,
	hash,
	localSlot,
	NOW,
	sourcesFor,
	startOfWeekLocal,
} from "./derive.ts";
import { withCoordination } from "./coordination-fixtures.ts";

/**
 * `@handle` availability fixtures — the fat scheduling service's answer for `/[handle]/availability`
 * while the profile backend gate is off. DERIVES weekly working hours, blackout dates, and a schedule
 * of bookable slots deterministically from the resolved {@link ProfileView} (its handle hash + IANA
 * timezone). Per §Part 1.4 every block on a PUBLIC availability page is privacy-masked to Available /
 * Busy / Tentative — the sole exception is a public group session, which may show its title + attendee
 * counter. Only freelancers are bookable (organisations/individuals are buyer-only, root CLAUDE.md
 * Decisions #9/#10). The live path (RLS-scoped `scheduling.*`) fills in behind the same gate.
 */

/**
 * Weekly windows, varied by seed — working hours plus the narrower **call windows** inside them.
 *
 * The two `availability_kind` bands are genuinely different claims, which is why the schema carries
 * both (Decision #56): `working_hours` is the broad "at my desk" overlay, `call_window` is the subset
 * during which the owner accepts a booking from a stranger. Emitting only the broad band and letting
 * the booking layer treat it as bookable would publish a provider's entire working week as open —
 * which is both wrong and the kind of wrong nobody notices, because the grid looks healthy.
 *
 * The call windows are deliberately a MINORITY of the working week: mid-morning and mid-afternoon on
 * most workdays, never the first or last hour, never Saturday. That is what a real provider's booking
 * page looks like, and it is what makes the picker's "offered but spoken for" states reachable.
 */
function buildRules(seed: number): AvailabilityRule[] {
	const startH = 8 + (seed % 2); // 8 or 9
	const closeH = 17 + (seed % 2); // 17 or 18
	const days = seed % 3 === 0 ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
	const rules: AvailabilityRule[] = [];
	for (const wd of days) {
		const isSat = wd === 6;
		rules.push({
			weekday: wd,
			startMinute: (startH + (isSat ? 1 : 0)) * 60,
			endMinute: isSat ? 13 * 60 : 12 * 60 + 30,
			label: "Morning",
			kind: "working_hours",
		});
		if (!isSat) {
			rules.push({
				weekday: wd,
				startMinute: 13 * 60 + 30,
				endMinute: closeH * 60,
				label: "Afternoon",
				kind: "working_hours",
			});
		}
	}
	for (const wd of callWindowDays(seed, days)) {
		rules.push({
			weekday: wd,
			startMinute: (startH + 1) * 60 + 30,
			endMinute: 12 * 60,
			label: "Open for calls",
			kind: "call_window",
		});
		rules.push({
			weekday: wd,
			startMinute: 14 * 60,
			endMinute: (closeH - 1) * 60,
			label: "Open for calls",
			kind: "call_window",
		});
	}
	return rules;
}

/**
 * Which weekdays this owner opens for bookings — a stable subset of the days they work.
 *
 * Never all of them, and never none: a provider who takes calls every working hour is not modelling
 * anything a real booking page has to cope with, and one who takes none makes the picker unreachable
 * across the whole corpus. Saturday is excluded outright — an owner who works a Saturday morning is
 * catching up, not receiving strangers.
 */
function callWindowDays(seed: number, workdays: readonly number[]): number[] {
	const weekdays = workdays.filter((d) => d >= 1 && d <= 5);
	// Drop one workday, chosen stably, so the rail always has a visible closed day inside its fortnight.
	const skip = weekdays[seed % weekdays.length];
	return weekdays.filter((d) => d !== skip);
}

/** A couple of upcoming time-off / holiday spans. */
function buildBlackouts(seed: number, tz: string) {
	const weekMon = startOfWeekLocal(NOW, tz);
	const off = addDaysLocal(weekMon, 14 + (seed % 3), tz);
	const holiday = addDaysLocal(weekMon, 28 + 4, tz);
	return [
		{ start: off, end: addDaysLocal(off, 3, tz), label: "Time off" },
		{ start: holiday, end: addDaysLocal(holiday, 1, tz), label: "Public holiday" },
	];
}

/** Bookable / busy / session events across the previous, current, and next two weeks. */
function buildSlots(seed: number, tz: string, rules: AvailabilityRule[]): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	const weekMon = startOfWeekLocal(NOW, tz);
	const workdays = Array.from(new Set(rules.map((r) => r.weekday))).sort((a, b) => a - b);

	for (let w = -1; w <= 2; w++) {
		const base = addDaysLocal(weekMon, w * 7, tz);
		workdays.forEach((wd, idx) => {
			const dayOffset = (wd - 1 + 7) % 7;
			const day = addDaysLocal(base, dayOffset, tz);
			const h = hash(`${seed}:av:${w}:${wd}`);
			if (idx % 2 === 0) {
				const s = localSlot(day, 10 * 60 + (h % 2) * 30, 60, tz);
				events.push({
					id: `av-${w}-${wd}`,
					title: "Available",
					kind: "availability",
					status: "available",
					masked: true,
					start: s.start,
					end: s.end,
				});
			}
			if (idx % 3 === 1) {
				const s = localSlot(day, 14 * 60, 90, tz);
				events.push({
					id: `busy-${w}-${wd}`,
					title: "Busy",
					kind: "busy",
					status: "busy",
					masked: true,
					sources: externalSourceFor(`${seed}:busy:${w}:${wd}`),
					start: s.start,
					end: s.end,
				});
			}
		});

		// A weekly public group session (Wednesday) — not masked; shows the attendee counter.
		const wed = addDaysLocal(base, (3 - 1 + 7) % 7, tz);
		const s = localSlot(wed, 16 * 60, 60, tz);
		events.push({
			id: `ses-${w}`,
			title: "Open office hours",
			kind: "session",
			status: "confirmed",
			start: s.start,
			end: s.end,
			attendees: 3 + (hash(`${seed}:ses:${w}`) % 9),
			capacity: 12,
			meta: "Group session",
			location: "Live",
			sources: sourcesFor(`${seed}:ses:${w}`),
		});
	}
	return events.sort((a, b) => a.start - b.start);
}

/**
 * The coordination store key for a `@handle`'s availability. Exported so a WRITE addresses the same
 * key the READ derived — keyed on the RESOLVED handle, so `@Ada` and `@ada` cannot end up with two
 * separate sets of RSVPs.
 */
export function availabilitySurfaceKey(handle: string): string | null {
	const profile = findProfile(handle);
	return profile ? `availability:${profile.handle}` : null;
}

/**
 * Resolve the availability schedule page for a `@handle`. `null` → 404.
 *
 * This is the platform's most exposed schedule read — a guest-reachable page for anybody's profile —
 * so `viewer` defaults to nobody and every event comes back with no seated party, which is what the
 * service's privacy projection then keys the withholding on.
 */
export function findAvailabilityPage(
	handle: string,
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
	sim?: SchedulingSim,
): SchedulePage | null {
	const profile = findProfile(handle);
	if (!profile) return null;
	const seed = hash(profile.handle);
	const tz = profile.location.timezone;
	const isFreelancer = profile.kind === "freelancer";
	const rules = buildRules(seed);
	const events = isFreelancer ? buildSlots(seed, tz, rules) : [];
	// The office hours recur weekly, so a seat bought today is worth every remaining occurrence —
	// counted from the derived series rather than assumed, so the money figure and the grid agree.
	const upcomingSessions = events.filter((e) => e.kind === "session" && e.start >= NOW).length;
	const host = { name: profile.name, avatar: profile.avatar, handle: profile.handle };
	return {
		scope: "availability",
		title: "Availability",
		subtitle: profile.availabilityLabel,
		timezone: tz,
		ownerHandle: profile.handle,
		viewerCanBook: isFreelancer,
		availability: { timezone: tz, rules, blackouts: buildBlackouts(seed, tz) },
		events: events.map((event) =>
			withCoordination(event, {
				surfaceKey: `availability:${profile.handle}`,
				host,
				viewer,
				viewerHostsSurface: false,
				timezone: tz,
				remainingOccurrences: Math.max(1, upcomingSessions),
				sim,
			})
		),
	};
}
