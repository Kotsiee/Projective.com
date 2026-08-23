import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { CALENDAR_KIND_LABEL, calendarTime } from "@projective/ui/calendar";
import { Popover, Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { SchedulePage } from "@projective/types/scheduling";
import { integrationLabel } from "@projective/types/scheduling";
import { ProviderMark } from "../components/provider-marks.tsx";
import {
	availabilityOpen,
	calendarFocus,
	calendarPage,
	calendarQuery,
	calendarView,
	filtersEngaged,
	hiddenKinds,
	hiddenSources,
	importedEvents,
	kindsOnPage,
	periodLabelFor,
	sourcesOnPage,
	toggleKind,
	toggleSource,
} from "../core/calendar-state.ts";

/**
 * CalendarHeaderBand — the middle-nav HEADER band on `/calendar`: whose week this is, which week it
 * is, and how to narrow it.
 *
 * Exactly `--shell-midnav-header-h` tall and transparent, per the band contract: the tonal surface is
 * the shell's own glass underlay and the seam beneath is the canvas frame's hairline, so painting a
 * plate or a second rule here doubles both.
 *
 * **The period trail lives here, not in the grid.** The engine's own header is suppressed on this
 * surface (`hideHeader`), because a shell band and an in-body toolbar carrying the same Prev/Today/
 * Next would be two controls for one fact.
 *
 * **Below 767px the band inherits the lane's duties.** `middle-nav.css` removes the lane at exactly
 * that width, and it is the only place the search and the view switch live — `/wallet` proved the
 * duty must TRANSFER (a phone with no route to a section is a surface with no navigation), and
 * `/messages` proved what happens when it does not. The transfer is a viewport media query, not a
 * container query, precisely because it is keyed on the shell removing the lane rather than on this
 * band's own width.
 */
export interface CalendarHeaderBandProps {
	/** The SSR page, so the band's identity and filter options paint in the first byte. */
	initial: SchedulePage | null;
}

export default function CalendarHeaderBand(props: CalendarHeaderBandProps): JSX.Element {
	const filterOpen = useSignal(false);
	const filterRef = useRef<HTMLButtonElement>(null);

	const page = calendarPage.value ?? props.initial;
	const events = [...(page?.events ?? []), ...importedEvents.value];
	const sources = sourcesOnPage(events);
	const kinds = kindsOnPage(events);
	const tz = page?.timezone ?? "UTC";

	// Derived here, from the engine's own matrix, so the trail is right in the FIRST byte. Reading a
	// value the grid published left it empty at SSR and flipping to the real week on hydration.
	const period = periodLabelFor(calendarView.value, calendarFocus.value, tz);

	/**
	 * Move the focused instant by one period.
	 *
	 * Through `calendarTime`, the engine's OWN zoned-date matrix, rather than millisecond arithmetic:
	 * a day is 23 or 25 hours twice a year and a month is not 30 days, so a local `+ 7 * 86_400_000`
	 * would drift the trail off the week the grid is drawing on exactly the days it matters. The band
	 * moves the focus and the engine re-derives everything else from it.
	 */
	function step(delta: number): void {
		const view = calendarView.value;
		const from = calendarFocus.value;
		calendarFocus.value = view === "day"
			? calendarTime.addZonedDays(from, delta, tz)
			: view === "week"
			? calendarTime.addZonedDays(from, delta * 7, tz)
			: calendarTime.addZonedMonths(from, delta, tz);
	}

	return (
		<div class="cal-band">
			<div class="cal-band__identity">
				<span class="cal-band__name">{page?.title ?? "Calendar"}</span>
				<span class="cal-band__tz">{tz.replace(/_/g, " ")}</span>
			</div>

			<div class="cal-band__trail" role="group" aria-label="Change period">
				<Tooltip content="Today">
					<button
						type="button"
						class="cal-band__navbtn"
						aria-label="Go to today"
						onClick={() => (calendarFocus.value = Date.now())}
					>
						<Icon name="calendar" size="xs" />
					</button>
				</Tooltip>
				<Tooltip content="Previous">
					<button
						type="button"
						class="cal-band__navbtn"
						aria-label="Previous period"
						onClick={() => step(-1)}
					>
						<Icon name="chevron-left" size="xs" />
					</button>
				</Tooltip>
				<span class="cal-band__period">{period}</span>
				<Tooltip content="Next">
					<button
						type="button"
						class="cal-band__navbtn"
						aria-label="Next period"
						onClick={() => step(1)}
					>
						<Icon name="chevron-right" size="xs" />
					</button>
				</Tooltip>
			</div>

			<div class="cal-band__controls">
				{
					/*
					 * The search is the LANE's above 767px and this band's below it — one control that moves,
					 * never two. `middle-nav.css` removes the lane at that width and it was the only place
					 * find-in-calendar lived.
					 */
				}
				<label class="cal-band__search">
					<Icon name="search" size="xs" class="cal-band__searchglyph" aria-hidden="true" />
					<input
						class="cal-band__searchinput"
						type="search"
						value={calendarQuery.value}
						placeholder="Search"
						aria-label="Search your calendar"
						onInput={(e) => (calendarQuery.value = (e.currentTarget as HTMLInputElement).value)}
					/>
				</label>

				<Tooltip content="Filter what is shown">
					<button
						type="button"
						ref={filterRef}
						class="cal-band__iconbtn"
						data-on={filtersEngaged() ? "true" : undefined}
						aria-label="Filter what is shown"
						aria-haspopup="dialog"
						aria-expanded={filterOpen.value ? "true" : "false"}
						onClick={() => (filterOpen.value = !filterOpen.value)}
					>
						<Icon name="filter" size="xs" />
					</button>
				</Tooltip>
				<Popover
					open={filterOpen}
					targetRef={filterRef}
					placement="bottom-end"
					avoid={[".ui-app-shell__sidebar"]}
				>
					<div class="cal-filters">
						<fieldset class="cal-filters__group">
							<legend class="cal-filters__legend">Calendars</legend>
							{sources.length === 0
								? <p class="cal-filters__none">Nothing on this week names a calendar.</p>
								: sources.map((slug) => (
									<label class="cal-filters__option" key={slug}>
										<input
											type="checkbox"
											class="cal-filters__box"
											checked={!hiddenSources.value.includes(slug)}
											onChange={() => toggleSource(slug)}
										/>
										<span class="cal-filters__mark" aria-hidden="true">
											<ProviderMark source={slug} size={14} />
										</span>
										<span class="cal-filters__label">{integrationLabel(slug)}</span>
									</label>
								))}
						</fieldset>

						<fieldset class="cal-filters__group">
							<legend class="cal-filters__legend">Event types</legend>
							{kinds.map((kind) => (
								<label class="cal-filters__option" key={kind}>
									<input
										type="checkbox"
										class="cal-filters__box"
										checked={!hiddenKinds.value.includes(kind)}
										onChange={() => toggleKind(kind)}
									/>
									<span class="cal-filters__label">{CALENDAR_KIND_LABEL[kind]}</span>
								</label>
							))}
						</fieldset>
					</div>
				</Popover>

				{
					/*
					 * Working hours, inherited from the lane below 767px.
					 *
					 * It only WRITES the shared signal — the dialog itself stays mounted by the lane, which
					 * is `display: none` at this width but still in the DOM, and whose panel escapes through
					 * `BodyPortal` regardless. Mounting a second copy here would open two dialogs at once on
					 * every width where both regions exist.
					 */
				}
				<Tooltip content="Working hours and leave">
					<button
						type="button"
						class="cal-band__iconbtn cal-band__iconbtn--mobile"
						aria-label="Working hours and leave"
						aria-haspopup="dialog"
						onClick={() => (availabilityOpen.value = true)}
					>
						<Icon name="clock" size="xs" />
					</button>
				</Tooltip>

				{
					/*
					 * The view switch, inherited from the lane footer below 767px. Hidden above it by CSS
					 * rather than rendered conditionally, so there is no frame in which both are drawn and no
					 * client width observer deciding which.
					 */
				}
				<div class="cal-band__views" role="group" aria-label="Calendar view">
					{(["day", "week", "month"] as const).map((v) => (
						<button
							key={v}
							type="button"
							class="cal-band__view"
							data-on={calendarView.value === v ? "true" : undefined}
							aria-pressed={calendarView.value === v ? "true" : "false"}
							onClick={() => (calendarView.value = v)}
						>
							{v === "day" ? "D" : v === "week" ? "W" : "M"}
							<span class="cal-band__viewname">{v}</span>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
