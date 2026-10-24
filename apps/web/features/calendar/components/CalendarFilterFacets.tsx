import type { JSX } from "preact";
import { CALENDAR_KIND_LABEL, calendarTime } from "@projective/ui/calendar";
import { DatePicker, type DateValue } from "@projective/ui/fields";
import { LaneFilterChoices, LaneFilterFacet, LaneFilterIcons } from "@projective/ui/navigation";
import type { CalendarEvent } from "@projective/types/scheduling";
import { integrationLabel } from "@projective/types/scheduling";
import { ProviderMark } from "./provider-marks.tsx";
import {
	dateRange,
	hiddenSources,
	kindsOnPage,
	ownersOnPage,
	shownKinds,
	shownOwners,
	sourcesOnPage,
	toggleOwner,
	toggleShownKind,
	toggleSource,
} from "../core/calendar-state.ts";

/** Props for {@link CalendarFilterFacets}. */
export interface CalendarFilterFacetsProps {
	/** Every entry on the page, unfiltered — the facets offer only what is actually there. */
	events: readonly CalendarEvent[];
	/** The agenda's zone: a picked day is that zone's midnight, not the browser's. */
	tz: string;
}

/** A picked calendar day, read as midnight in the agenda's zone. */
function zonedDay(d: Date, tz: string): number {
	return calendarTime.zonedTimeToMs(d.getFullYear(), d.getMonth() + 1, d.getDate(), 0, 0, tz);
}

/**
 * CalendarFilterFacets — the `/calendar` filter facets: Event type · Owner · Calendars · Dates.
 *
 * Rendered inside the lane's shared `LaneFilterPopover` (the `/projects` anatomy, which owns the
 * heading and Reset) and, below 767px where the shell removes the lane, inside the header band's
 * filter — one set of facets that moves with the lane rather than two that could disagree. Every
 * facet writes the shared `calendar-state` signals, so the grid and the lane's list narrow together.
 *
 * Event type and Owner read the `/projects` way (nothing pressed is everything). Calendars stays a
 * LAYER switch — pressed is shown — because withdrawing one calendar is the question it answers
 * (`hiddenSources`).
 */
export function CalendarFilterFacets(props: CalendarFilterFacetsProps): JSX.Element {
	const { events, tz } = props;
	const kinds = kindsOnPage(events);
	const owners = ownersOnPage(events);
	const sources = sourcesOnPage(events);
	const range = dateRange.value;
	// The picker's end is the last day INCLUDED; the stored window's end is the first day after it.
	const picked: DateValue = range
		? [new Date(range[0]), new Date(calendarTime.addZonedDays(range[1], -1, tz))]
		: null;

	return (
		<>
			{kinds.length > 1
				? (
					<LaneFilterChoices
						label="Event type"
						options={kinds.map((k) => ({ value: k, label: CALENDAR_KIND_LABEL[k] }))}
						active={shownKinds(kinds)}
						onToggle={(k) => toggleShownKind(k, kinds)}
					/>
				)
				: null}

			{owners.length > 1
				? (
					<LaneFilterChoices
						label="Owner"
						options={owners}
						active={shownOwners.value}
						onToggle={toggleOwner}
					/>
				)
				: null}

			{sources.length > 0
				? (
					<LaneFilterIcons
						label="Calendars"
						options={sources.map((slug) => ({
							value: slug,
							label: integrationLabel(slug),
							icon: <ProviderMark source={slug} size={14} />,
						}))}
						active={sources.filter((s) => !hiddenSources.value.includes(s))}
						onToggle={toggleSource}
					/>
				)
				: null}

			<LaneFilterFacet label="Dates">
				<DatePicker
					size="sm"
					selectionMode="range"
					value={picked}
					placeholder="Any start and end date"
					aria-label="Start and end date"
					dateFormat="M d, yy"
					showButtonBar
					onValueChange={(v: DateValue) => {
						if (!Array.isArray(v) || v.length === 0) {
							dateRange.value = null;
							return;
						}
						// A range half-picked is not a filter yet; the first click must not empty the grid.
						if (v.length < 2 || !v[1]) return;
						const from = zonedDay(v[0], tz);
						const to = calendarTime.addZonedDays(zonedDay(v[1], tz), 1, tz);
						dateRange.value = [Math.min(from, to), Math.max(from, to)];
					}}
				/>
			</LaneFilterFacet>
		</>
	);
}
