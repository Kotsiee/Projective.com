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
import { buildRules } from "./hours.ts";

/**
 * `@handle` availability fixtures — the fat scheduling service's answer for `/[handle]/availability`
 * while the profile backend gate is off. DERIVES weekly working hours, blackout dates, and a schedule
 * of bookable slots deterministically from the resolved {@link ProfileView} (its handle hash + IANA
 * timezone). Per §Part 1.4 every block on a PUBLIC availability page is privacy-masked to Available /
 * Busy / Tentative — the sole exception is a public group session, which may show its title + attendee
 * counter. The weekly bands themselves come from `hours.ts`, which the profile projection also reads —
 * one derivation, so the calendar and the `/[handle]` context bar cannot disagree about the hours.
 * Only freelancers are bookable (organisations/individuals are buyer-only, root CLAUDE.md
 * Decisions #9/#10). The live path (RLS-scoped `scheduling.*`) fills in behind the same gate.
 */

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
		events: events.map((event, eventIndex) =>
			withCoordination(event, {
				surfaceKey: `availability:${profile.handle}`,
				eventIndex,
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
