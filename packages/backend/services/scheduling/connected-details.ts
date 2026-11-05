import {
	type CalendarEvent,
	type EventMeeting,
	MEETING_PROVIDER_LABEL,
	meetingProviderOf,
} from "@projective/types/scheduling";

/**
 * connected-details — a connected calendar's entries as their owner reads them (Decision #387).
 *
 * Every occurrence stays its own row, so the booking gates and free/busy read nothing new. A series
 * reaches the page in the shape Projective's own takes: the first occurrence here stands as its master
 * and carries the rule, and the rest point back at it. They leave an agenda they share to it, because a
 * daily series would otherwise send the same notes a year's worth of times.
 */

/** One entry's row from `scheduling.get_own_event_details`. */
export interface OwnEventDetails {
	event_id: string;
	title: string | null;
	location: string | null;
	description: string | null;
	series_id: string | null;
	recurrence_rule: string | null;
	join_url: string | null;
}

/** The entry's own meeting, named from its link, or nothing for a link no browser could open. */
function meetingAt(joinUrl: string | null): { meeting: EventMeeting } | null {
	if (!joinUrl || !URL.canParse(joinUrl)) return null;
	const provider = meetingProviderOf(new URL(joinUrl));
	return {
		meeting: {
			provider,
			providerLabel: MEETING_PROVIDER_LABEL[provider],
			joinUrl,
			passcode: null,
			details: null,
			pending: false,
		},
	};
}

/** `events` with `details` folded in. An entry with no details is left exactly as it came. */
export function applyOwnDetails(
	events: readonly CalendarEvent[],
	details: ReadonlyMap<string, OwnEventDetails>,
): CalendarEvent[] {
	const masters = new Map<string, CalendarEvent>();
	for (const event of [...events].sort((a, b) => a.start - b.start)) {
		const series = details.get(event.id)?.series_id;
		if (series && !masters.has(series)) masters.set(series, event);
	}

	return events.map((event) => {
		const own = details.get(event.id);
		if (!own) return event;
		// An entry from outside has no organiser here, so there is nobody to name.
		const { masked: _masked, organiser: _organiser, ...named } = event;
		const master = own.series_id ? masters.get(own.series_id) : undefined;
		const later = master && master.id !== event.id ? master : undefined;
		const shared = later ? details.get(later.id)?.description : undefined;
		return {
			...named,
			connected: true,
			title: own.title ?? "Busy",
			...meetingAt(own.join_url),
			...(own.location ? { location: own.location } : {}),
			...(own.description && own.description !== shared ? { description: own.description } : {}),
			...(later
				? { recurrenceParentId: later.id }
				: own.recurrence_rule
				? { recurrenceRule: own.recurrence_rule }
				: {}),
		};
	});
}
