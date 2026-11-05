import type { JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { calendarTime, scrollBehaviorFor } from "@projective/ui/calendar";
import {
	LaneBar,
	LaneCollapseButton,
	LaneCreateButton,
	LaneEmpty,
	LaneFilterPopover,
	LaneFooter,
	LaneFooterActions,
	LaneHead,
	LaneIconButton,
	LaneList,
	LaneSearch,
	type LaneToggleOption,
	LaneToggleRow,
} from "@projective/ui/navigation";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import {
	type CalendarEvent,
	ENTRY_CLASS_PLURAL,
	type EntryClass,
	type SchedulePage,
} from "@projective/types/scheduling";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import { CalendarFilterFacets } from "../components/CalendarFilterFacets.tsx";
import { calendarModeHref } from "../core/availability-view.ts";
import { providerMarkFor } from "../components/provider-marks.tsx";
import {
	activeFilterCount,
	calendarFocus,
	calendarPage,
	calendarQuery,
	classesOnPage,
	importedEvents,
	laneSpotlight,
	requestCreate,
	resetFilters,
	selectedEventId,
	selectEvent,
	showOnlyClass,
	soleVisibleClass,
	sourceIsVisible,
	visibleEvents,
} from "../core/calendar-state.ts";
import { repeatSentence } from "../core/event-recurrence.ts";
import { listRows } from "../core/event-series.ts";
import { timesLabel } from "../core/event-view.ts";

/**
 * CalendarLane — the middle-nav lane for `/calendar`: what is coming, and when am I available.
 *
 * Built from the shared `@projective/ui/navigation` lane chrome, so it reads as the same control set
 * as the `/projects` feed, the `/messages` inbox and the `/wallet` rail rather than a fourth
 * lookalike. Both presentations — the expanded stack and the collapsed icon rail — are always in the
 * DOM and CSS reveals exactly one, keyed off the splitter's `data-mode`. A client width observer
 * would paint the wrong one for a frame on every load.
 *
 * The month navigator is not here: it is the middle-nav PANEL's (`CalendarPanel`), opened from the
 * header band, so the lane's height goes to the list it exists for.
 *
 * It fetches NOTHING. The body island owns the read and publishes it to {@link calendarPage}; this
 * lane renders whatever is in there, so the upcoming list and the grid can never be built from two
 * different responses.
 *
 * **When I am available is its own page** (`/calendar?view=availability`, Decision #376), reached
 * from the header band's Agenda ⇄ Availability switch and the rail's clock, so this lane is the
 * agenda's alone and its list gets the whole height.
 *
 * **The list scrolls on its own.** It is every entry the filters leave, in order and with a series
 * listed once ({@link listRows}), rather than a window
 * that followed the grid's focus — a list that re-anchored whenever the grid scrolled was the grid
 * scrolling it by proxy. The two views meet only on a pick: a row moves the grid onto its entry, and
 * an entry picked on the grid brings its row to the middle of the list ({@link selectEvent}).
 *
 * **Filter sits beside the search**, the `/projects` anatomy: the shared {@link LaneFilterPopover} over
 * {@link CalendarFilterFacets}, narrowing the grid and this list together.
 *
 * **New event is the lane footer's one create action**, beside a ghost Scheduling settings gear — the
 * anatomy of every lane footer (`/messages`, `/projects`; Decision #378). The footer band carries it
 * only below 767px, where the shell removes this lane, so it moves rather than doubles (Decisions
 * #60/#63). The view switch stays the footer band's.
 */
export interface CalendarLaneProps {
	/** The SSR page, so the lane paints its first frame with the same data the grid has. */
	initial: SchedulePage | null;
}

/** The registry glyph each class is drawn with in the quick row. */
const CLASS_ICON: Record<EntryClass, IconName> = { event: "calendar", reminder: "flag" };

export default function CalendarLane(props: CalendarLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	const filterOpen = useSignal(false);
	const laneRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		// The splitter owns the width; the lane mirrors its state only so the toggle glyph is right.
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (el) collapsed.value = el.dataset.mode === "collapsed";
	}, []);

	const setCollapsed = (next: boolean) => {
		collapsed.value = next;
		globalThis.dispatchEvent(
			new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
		);
	};

	// The body's published page wins the moment it exists; the SSR prop covers the first frame.
	const page = calendarPage.value ?? props.initial;
	const tz = page?.timezone ?? "UTC";
	const all: CalendarEvent[] = [...(page?.events ?? []), ...importedEvents.value];
	const selected = selectedEventId.value;
	const listed = listRows(visibleEvents(all), page?.now ?? Date.now(), selected);

	/** Bring one row to the middle of the list — the list's own scroll, never the page's. */
	function centreRow(id: string, behavior: ScrollBehavior): void {
		const list = laneRef.current?.querySelector<HTMLElement>(".cal-lane__list");
		const row = list?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`);
		if (!list || !row) return;
		list.scrollTo({ top: row.offsetTop - (list.clientHeight - row.offsetHeight) / 2, behavior });
	}

	// The list opens on what is next rather than on the oldest entry the page carries.
	useEffect(() => {
		const now = page?.now ?? Date.now();
		const next = listed.find((e) => e.end > now);
		if (next) centreRow(next.id, "auto");
	}, []);

	// A pick on the grid: bring the row into view and let it glow once.
	const flashing = laneSpotlight.value;
	useEffect(() => {
		if (!flashing) return;
		// A task, so the row the pick just selected has rendered before it is measured.
		setTimeout(() => centreRow(flashing, scrollBehaviorFor()), 0);
	}, [flashing]);

	/*
	 * The quick row offers only the classes actually ON the page, so it never presents a filter that
	 * would empty the list — and it is SINGLE-select, because the shared lane chrome names every
	 * toggle "Show {label} only" and a control has to mean what its accessible name says. It writes
	 * the same `hiddenClasses` deny list the filter's facet reads, so the two are one axis with two
	 * entry points rather than two filters that can disagree.
	 */
	const present = classesOnPage(all);
	const classToggles: readonly LaneToggleOption<EntryClass>[] = present.map((entry) => ({
		key: entry,
		label: ENTRY_CLASS_PLURAL[entry],
		icon: <Icon name={CLASS_ICON[entry]} />,
	}));
	const solo = soleVisibleClass(present);

	return (
		<div class="cal-lanewrap">
			{/* Collapsed presentation — revealed by CSS at the rail density. */}
			<div class="cal-rail">
				<div class="cal-rail__items" role="list">
					<Tooltip content="Today" placement="right" density="compact">
						<button
							type="button"
							class="cal-rail__item"
							aria-label="Go to today"
							onClick={() => (calendarFocus.value = Date.now())}
						>
							<Icon name="calendar" />
						</button>
					</Tooltip>
					<Tooltip content="Availability" placement="right" density="compact">
						<a
							class="cal-rail__item"
							href={calendarModeHref("availability")}
							aria-label="Availability"
						>
							<Icon name="clock" />
						</a>
					</Tooltip>
				</div>

				<div class="cal-rail__bottom">
					<Tooltip content="New event" placement="right" density="compact">
						<button
							type="button"
							class="cal-rail__item cal-rail__item--accent"
							aria-label="New event"
							onClick={requestCreate}
						>
							<Icon name="plus" />
						</button>
					</Tooltip>
					<LaneCollapseButton
						collapsed
						icon={<SidebarToggleIcon />}
						tooltipPlacement="right"
						onToggle={() => setCollapsed(false)}
					/>
				</div>
			</div>

			{/* Expanded presentation. */}
			<div class="cal-lane" ref={laneRef}>
				<LaneHead class="cal-lane__head">
					<LaneBar>
						<LaneSearch
							value={calendarQuery.value}
							placeholder="Search your calendar"
							label="Search your calendar"
							icon={<Icon name="search" />}
							onInput={(v) => (calendarQuery.value = v)}
						/>
						<LaneFilterPopover
							open={filterOpen}
							active={activeFilterCount()}
							icon={<Icon name="filter" />}
							onReset={resetFilters}
						>
							<CalendarFilterFacets events={all} tz={tz} />
						</LaneFilterPopover>
					</LaneBar>

					{classToggles.length > 1
						? (
							<LaneToggleRow
								label="Event type"
								options={classToggles}
								active={solo ? [solo] : []}
								onToggle={(c) => showOnlyClass(c, present)}
							/>
						)
						: null}
				</LaneHead>

				<LaneList label="Events" class="cal-lane__list">
					{listed.length === 0
						? (
							<LaneEmpty
								title="No events"
								note="Nothing matches the search and filters you have set."
							/>
						)
						: listed.map((e) => (
							<UpcomingRow
								key={e.id}
								event={e}
								repeat={repeatSentence(e, all, tz)}
								tz={tz}
								selected={e.id === selected}
								flashing={e.id === flashing}
							/>
						))}
				</LaneList>

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
					<LaneFooterActions>
						<LaneIconButton
							icon={<Icon name="settings" />}
							label="Scheduling settings"
							tooltipPlacement="top"
							onClick={() => openSettings("scheduling")}
						/>
						<LaneCreateButton
							label="New event"
							icon={<Icon name="plus" />}
							onClick={requestCreate}
						/>
					</LaneFooterActions>
				</LaneFooter>
			</div>
		</div>
	);
}

/**
 * One upcoming entry: when, what, and which calendars it is on.
 *
 * The provider marks are the same stack the grid draws, so an entry recognised in the lane is
 * recognisable in the grid. A masked block shows its privacy-safe status instead of a title, exactly
 * as it does everywhere else — the lane is not a way around the projection.
 */
function UpcomingRow(
	{ event, repeat, tz, selected, flashing }: {
		event: CalendarEvent;
		/** How it repeats, for the one row a series gets. */
		repeat: string | null;
		tz: string;
		selected: boolean;
		flashing: boolean;
	},
): JSX.Element {
	const title = event.masked
		? event.status === "available"
			? "Available"
			: event.status === "tentative"
			? "Tentative"
			: "Busy"
		: event.title;
	const when = event.allDay
		? calendarTime.fmtDayLabel(event.start, tz)
		: `${calendarTime.fmtDayLabel(event.start, tz)} · ${timesLabel(event, tz, true)}`;
	/*
	 * Paired, and filtered on the RESULT of the dispatcher rather than on a rendered component.
	 * `<ProviderMark …/>` is a VNode even when it draws nothing, so filtering on it kept the
	 * platform's own copy and put an empty pip on every row.
	 *
	 * Two suppressions, and each matches the grid so a row and its block never say different things:
	 * a MASKED entry draws none at all (§Part 1.4 allows it one fact — Available / Busy / Tentative —
	 * and which calendar it lives on is not that fact), and a calendar the reader has switched off
	 * draws none either, because a withdrawn layer must leave no trace on the entries it did not take
	 * with it.
	 */
	const marks: { source: string; mark: VNode }[] = [];
	for (const source of event.masked ? [] : event.sources ?? []) {
		if (!sourceIsVisible(source)) continue;
		const mark = providerMarkFor(source, 12);
		if (mark) marks.push({ source, mark });
	}

	const row = (
		<span class="cal-up__body">
			<span class="cal-up__when">{when}</span>
			<span class="cal-up__title">{title}</span>
			{event.meta || repeat
				? <span class="cal-up__meta">{[event.meta, repeat].filter(Boolean).join(" · ")}</span>
				: null}
		</span>
	);

	/*
	 * The row is a PICK, not a link: it opens the entry beside the grid and moves the grid onto it.
	 * Where the entry lives (its engagement, `href`) is one step further, from the details it opens.
	 * The row's rect is what a popover points from, when that is how its reader has things open.
	 */
	return (
		<div
			class="cal-up"
			data-kind={event.kind}
			data-event-id={event.id}
			data-selected={selected ? "true" : undefined}
			data-flash={flashing ? "true" : undefined}
		>
			<button
				type="button"
				class="cal-up__link"
				aria-current={selected ? "true" : undefined}
				onClick={(e) => {
					const box = e.currentTarget.getBoundingClientRect();
					selectEvent(event, "list", { x: box.left, y: box.top, w: box.width, h: box.height });
				}}
			>
				{row}
			</button>
			{marks.length > 0
				? (
					<span class="cal-up__sources" aria-hidden="true">
						{marks.map((m) => <span class="cal-up__source" key={m.source}>{m.mark}</span>)}
					</span>
				)
				: null}
		</div>
	);
}
