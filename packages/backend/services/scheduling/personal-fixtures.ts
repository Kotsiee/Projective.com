import type {
	AvailabilityRule,
	CalendarEvent,
	SchedulePage,
	SchedulingSim,
	SchedulingViewer,
} from "@projective/types/scheduling";
import { ANONYMOUS_VIEWER } from "@projective/types/scheduling";
import { allProjects } from "../projects/fixtures.ts";
import { findCalendarPage } from "./calendar-fixtures.ts";
import {
	addDaysLocal,
	externalSourceFor,
	hash,
	localSlot,
	NOW,
	startOfWeekLocal,
} from "./derive.ts";

/**
 * personal calendar fixtures — the fat scheduling service's answer for the `/calendar` hub while the
 * projects backend gate is off.
 *
 * This surface is not a fourth kind of calendar. It is the UNION of the engagements the acting
 * account is already on, which is why it derives by calling {@link findCalendarPage} for each of
 * them rather than inventing a parallel corpus: an entry the personal agenda shows and the same
 * entry on `/projects/{slug}/calendar` are then literally the same object, and the two cannot come
 * to disagree about when a stage review is. Everything else here — the working hours, the private
 * blocks pulled in from a connected calendar — is what a personal agenda has that a project's
 * does not.
 *
 * Deterministic like every sibling: a fixed reference clock, unsigned hashes, no RNG, so SSR and the
 * island's refetch agree byte for byte.
 */

/** The zone the personal agenda is read in. One zone, because a person has one working day. */
const PERSONAL_TZ = "Europe/London";

/**
 * The acting account's own working hours.
 *
 * Weekdays only, with a lunch gap, expressed in {@link PERSONAL_TZ}. Two bands per day rather than
 * one long one, because a solid 09:00–18:00 wash behind the grid says "always available" and is the
 * first thing anybody looking at their own calendar knows to be false.
 */
function personalRules(): AvailabilityRule[] {
	const rules: AvailabilityRule[] = [];
	for (const weekday of [1, 2, 3, 4, 5]) {
		rules.push({
			weekday,
			startMinute: 9 * 60,
			endMinute: 12 * 60 + 30,
			label: "Morning",
			kind: "working_hours",
		});
		rules.push({
			weekday,
			startMinute: 13 * 60 + 30,
			endMinute: 18 * 60,
			label: "Afternoon",
			kind: "working_hours",
		});
	}
	// A narrower window inside the working day during which an interruption is welcome — the
	// `call_window` half of the two-layer availability model (root CLAUDE.md §8 Decision #56).
	for (const weekday of [2, 4]) {
		rules.push({
			weekday,
			startMinute: 15 * 60,
			endMinute: 17 * 60,
			label: "Open for calls",
			kind: "call_window",
		});
	}
	return rules;
}

/** Booked leave — the "booked leaves" the availability manager lists beside the free blocks. */
function personalBlackouts() {
	const weekMon = startOfWeekLocal(NOW, PERSONAL_TZ);
	const leave = addDaysLocal(weekMon, 17, PERSONAL_TZ);
	const holiday = addDaysLocal(weekMon, 32, PERSONAL_TZ);
	return [
		{ start: leave, end: addDaysLocal(leave, 5, PERSONAL_TZ), label: "Annual leave" },
		{ start: holiday, end: addDaysLocal(holiday, 1, PERSONAL_TZ), label: "Public holiday" },
	];
}

/**
 * Private blocks mirrored in from a connected external calendar.
 *
 * Privacy-masked exactly as they are on a project calendar (§Part 1.4): a personal agenda is still a
 * response body, and a dentist appointment pulled from somebody's Google account has no business
 * carrying its real title through the API even when the reader is its owner — the field is not
 * populated, so there is nothing to leak if the projection is ever reused for a shared view.
 */
function externalBlocks(): CalendarEvent[] {
	const weekMon = startOfWeekLocal(NOW, PERSONAL_TZ);
	const out: CalendarEvent[] = [];
	for (let w = -1; w <= 2; w++) {
		const base = addDaysLocal(weekMon, w * 7, PERSONAL_TZ);
		for (let i = 0; i < 2; i++) {
			const h = hash(`personal:ext:${w}:${i}`);
			const day = addDaysLocal(base, h % 5, PERSONAL_TZ);
			const slot = localSlot(day, 8 * 60 + (h % 8) * 60, 30 + (h % 3) * 30, PERSONAL_TZ);
			out.push({
				id: `ext-${w}-${i}`,
				title: "Busy",
				kind: "busy",
				status: h % 4 === 0 ? "tentative" : "busy",
				masked: true,
				sources: externalSourceFor(`personal:ext:${w}:${i}`),
				start: slot.start,
				end: slot.end,
			});
		}
	}
	return out;
}

/**
 * Resolve the acting account's own agenda.
 *
 * `viewer` decides who is SEATED on each event, exactly as it does on the project calendar it
 * borrows from — it never changes which events exist. It defaults to nobody, so a caller that
 * forgets it produces a page with no party on it and the service's privacy projection then withholds
 * every coordination field.
 */
export function findPersonalCalendarPage(
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
	sim?: SchedulingSim,
): SchedulePage {
	const events: CalendarEvent[] = [];
	const seen = new Set<string>();

	for (const project of allProjects()) {
		const page = findCalendarPage({ projectId: project.slug, channelId: null }, viewer, sim);
		if (!page) continue;
		for (const event of page.events) {
			// Event ids are unique only WITHIN the page that derived them (`sync-{stageId}`, `task-0`),
			// so the union re-keys by the engagement it came from. Without this the five projects'
			// `task-0` entries collapse into one and four deadlines silently vanish.
			const id = `${project.slug}:${event.id}`;
			if (seen.has(id)) continue;
			seen.add(id);
			events.push({
				...event,
				id,
				// The engagement is the answer to "why is this in my week", so it goes on the strapline
				// the grid block already renders rather than into a second field nothing reads.
				meta: event.meta ? `${project.title} · ${event.meta}` : project.title,
				href: `/projects/${project.slug}/calendar`,
			});
		}
	}

	events.push(...externalBlocks());
	events.sort((a, b) => a.start - b.start);

	return {
		scope: "personal",
		title: "Calendar",
		subtitle: "Everything you are on, in one week",
		timezone: PERSONAL_TZ,
		ownerHandle: viewer.handle,
		// This is the viewer's OWN calendar: they are always allowed to put something in it.
		viewerCanBook: true,
		availability: {
			timezone: PERSONAL_TZ,
			rules: personalRules(),
			blackouts: personalBlackouts(),
		},
		events,
	};
}
