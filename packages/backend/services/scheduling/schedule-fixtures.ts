import type {
	AvailabilityRule,
	CalendarEvent,
	SchedulePage,
} from "@projective/types/scheduling";
import { findItem } from "../explore/query.ts";
import {
	addDaysLocal,
	hash,
	integrationsFor,
	localSlot,
	NOW,
	startOfWeekLocal,
	tzFor,
} from "./derive.ts";

/**
 * session-service schedule fixtures — the fat scheduling service's answer for `/view/[entity]/schedule`
 * while the explore backend gate is off. DERIVES a recurring class/session schedule for the viewed
 * entity (an explore item, e.g. a `serviceType: "Session"` service) from its id hash: a twice-weekly
 * public group session (with a live attendee counter — public group sessions may show it, §Part 1.4)
 * plus a scatter of bookable 1:1 slots (privacy-masked to "Available"). The live path (RLS-scoped
 * `scheduling.*` + the service's own recurrence rule) fills in behind the same gate.
 */

function hostRules(): AvailabilityRule[] {
	const out: AvailabilityRule[] = [];
	for (const wd of [1, 2, 3, 4, 5]) {
		out.push({ weekday: wd, startMinute: 9 * 60, endMinute: 12 * 60 + 30, label: "Morning" });
		out.push({ weekday: wd, startMinute: 13 * 60 + 30, endMinute: 18 * 60, label: "Afternoon" });
	}
	return out;
}

/** Resolve the session-schedule page for an explore entity id. `null` → 404. */
export function findSchedulePage(entityId: string): SchedulePage | null {
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

	return {
		scope: "schedule",
		title: item.title,
		subtitle,
		timezone: tz,
		ownerHandle: item.owner.handle,
		viewerCanBook: true,
		availability: { timezone: tz, rules: hostRules(), blackouts: [] },
		events: events.sort((a, b) => a.start - b.start),
		integrations: integrationsFor(seed),
	};
}
