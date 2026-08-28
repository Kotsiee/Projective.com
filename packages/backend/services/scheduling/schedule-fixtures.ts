import type {
	AvailabilityRule,
	CalendarEvent,
	SchedulePage,
	SchedulingSim,
	SchedulingViewer,
} from "@projective/types/scheduling";
import { ANONYMOUS_VIEWER } from "@projective/types/scheduling";
import { findItem } from "../explore/query.ts";
import {
	addDaysLocal,
	hash,
	localSlot,
	NOW,
	sourcesFor,
	startOfWeekLocal,
	tzFor,
} from "./derive.ts";
import { withCoordination } from "./coordination-fixtures.ts";

/**
 * session-service schedule fixtures — the fat scheduling service's answer for `/view/[entity]/schedule`
 * while the explore backend gate is off. DERIVES a recurring class/session schedule for the viewed
 * entity (an explore item, e.g. a `serviceType: "Session"` service) from its id hash: a twice-weekly
 * public group session (with a live attendee counter — public group sessions may show it, §Part 1.4)
 * plus a scatter of bookable 1:1 slots (privacy-masked to "Available"). The live path (RLS-scoped
 * `scheduling.*` + the service's own recurrence rule) fills in behind the same gate.
 */

/**
 * The host's weekly bands — broad working hours, plus the narrower **call windows** the booking
 * layer actually offers slots inside.
 *
 * Both kinds are emitted for the reason `availability_kind` exists at all (Decision #56): "I am at my
 * desk" and "interrupt me" are different claims, and a slot builder handed only the broad band would
 * publish the provider's whole working week as bookable by strangers. The seed varies which days
 * open, so the rail always contains at least one working day with no slots on it — the state a picker
 * that only ever sees full days will render wrongly.
 */
function hostRules(seed: number): AvailabilityRule[] {
	const out: AvailabilityRule[] = [];
	const workdays = [1, 2, 3, 4, 5];
	for (const wd of workdays) {
		out.push({
			weekday: wd,
			startMinute: 9 * 60,
			endMinute: 12 * 60 + 30,
			label: "Morning",
			kind: "working_hours",
		});
		out.push({
			weekday: wd,
			startMinute: 13 * 60 + 30,
			endMinute: 18 * 60,
			label: "Afternoon",
			kind: "working_hours",
		});
	}
	const closedDay = workdays[seed % workdays.length];
	for (const wd of workdays) {
		if (wd === closedDay) continue;
		out.push({
			weekday: wd,
			startMinute: 10 * 60,
			endMinute: 12 * 60,
			label: "Bookable",
			kind: "call_window",
		});
		out.push({
			weekday: wd,
			startMinute: 14 * 60,
			endMinute: 17 * 60,
			label: "Bookable",
			kind: "call_window",
		});
	}
	return out;
}

/**
 * The coordination store key for an entity's schedule. Exported so a WRITE addresses the same key
 * the READ derived.
 */
export function scheduleSurfaceKey(entityId: string): string | null {
	const item = findItem(entityId);
	return item ? `schedule:${item.id}` : null;
}

/**
 * Resolve the session-schedule page for an explore entity id. `null` → 404.
 *
 * A public marketing surface, so `viewer` defaults to nobody: the seat counter on a group session is
 * public (§Part 1.4), the people filling those seats are not.
 */
export function findSchedulePage(
	entityId: string,
	viewer: SchedulingViewer = ANONYMOUS_VIEWER,
	sim?: SchedulingSim,
): SchedulePage | null {
	const item = findItem(entityId);
	if (!item) return null;
	const seed = hash(item.id);
	const tz = tzFor(seed);
	const cap = 10 + (seed % 15);
	const weekMon = startOfWeekLocal(NOW, tz);
	const events: CalendarEvent[] = [];

	for (let w = 0; w <= 3; w++) {
		const base = addDaysLocal(weekMon, w * 7, tz);
		for (const wd of [2, 4]) {
			const day = addDaysLocal(base, (wd - 1 + 7) % 7, tz);
			const s = localSlot(day, 17 * 60, 60, tz);
			events.push({
				id: `cls-${w}-${wd}`,
				title: item.title,
				kind: "session",
				status: "confirmed",
				start: s.start,
				end: s.end,
				attendees: 2 + (hash(`${item.id}:${w}:${wd}`) % cap),
				capacity: cap,
				meta: item.type === "services" ? item.delivery : "Session",
				location: "Online",
				sources: sourcesFor(`${item.id}:cls:${w}:${wd}`),
			});
		}
		const av = localSlot(addDaysLocal(base, 0, tz), 11 * 60, 45, tz);
		events.push({
			id: `av-${w}`,
			title: "Available",
			kind: "availability",
			status: "available",
			masked: true,
			start: av.start,
			end: av.end,
		});
	}

	const subtitle = item.type === "services"
		? `${item.serviceType} · ${item.delivery}`
		: item.summary.slice(0, 140);

	const ordered = events.sort((a, b) => a.start - b.start);
	// A class runs twice a week for the derived horizon; a seat is worth every occurrence still to
	// come, counted from the series rather than assumed.
	const upcomingSessions = ordered.filter((e) => e.kind === "session" && e.start >= NOW).length;
	const host = { name: item.owner.name, avatar: item.owner.avatar, handle: item.owner.handle };

	return {
		scope: "schedule",
		title: item.title,
		subtitle,
		timezone: tz,
		ownerHandle: item.owner.handle,
		viewerCanBook: true,
		availability: { timezone: tz, rules: hostRules(seed), blackouts: [] },
		events: ordered.map((event) =>
			withCoordination(event, {
				surfaceKey: `schedule:${item.id}`,
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
