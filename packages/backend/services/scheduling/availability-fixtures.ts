import type {
	AvailabilityRule,
	CalendarEvent,
	SchedulePage,
} from "@projective/types/scheduling";
import { findProfile } from "../profile/profile-fixtures.ts";
import {
	addDaysLocal,
	hash,
	integrationsFor,
	localSlot,
	NOW,
	startOfWeekLocal,
} from "./derive.ts";

/**
 * `@handle` availability fixtures — the fat scheduling service's answer for `/[handle]/availability`
 * while the profile backend gate is off. DERIVES weekly working hours, blackout dates, and a schedule
 * of bookable slots deterministically from the resolved {@link ProfileView} (its handle hash + IANA
 * timezone). Per §Part 1.4 every block on a PUBLIC availability page is privacy-masked to Available /
 * Busy / Tentative — the sole exception is a public group session, which may show its title + attendee
 * counter. Only freelancers are bookable (organisations/individuals are buyer-only, root CLAUDE.md
 * Decisions #9/#10). The live path (RLS-scoped `scheduling.*`) fills in behind the same gate.
 */

/** Weekly working-hours windows (morning + afternoon; some weekends), varied by seed. */
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
		});
		if (!isSat) {
			rules.push({ weekday: wd, startMinute: 13 * 60 + 30, endMinute: closeH * 60, label: "Afternoon" });
		}
	}
	return rules;
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
					source: ["google", "outlook", "apple"][h % 3],
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
		});
	}
	return events.sort((a, b) => a.start - b.start);
}

/** Resolve the availability schedule page for a `@handle`. `null` → 404. */
export function findAvailabilityPage(handle: string): SchedulePage | null {
	const profile = findProfile(handle);
	if (!profile) return null;
	const seed = hash(profile.handle);
	const tz = profile.location.timezone;
	const isFreelancer = profile.kind === "freelancer";
	const rules = buildRules(seed);
	return {
		scope: "availability",
		title: "Availability",
		subtitle: profile.availabilityLabel,
		timezone: tz,
		ownerHandle: profile.handle,
		viewerCanBook: isFreelancer,
		availability: { timezone: tz, rules, blackouts: buildBlackouts(seed, tz) },
		events: isFreelancer ? buildSlots(seed, tz, rules) : [],
		integrations: integrationsFor(seed),
	};
}
