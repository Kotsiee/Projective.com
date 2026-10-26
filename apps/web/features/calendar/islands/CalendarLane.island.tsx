import type { JSX, VNode } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { CALENDAR_KIND_LABEL, calendarTime, scrollBehaviorFor } from "@projective/ui/calendar";
import {
	LaneBar,
	LaneCollapseButton,
	LaneEmpty,
	LaneFilterPopover,
	LaneFooter,
	LaneHead,
	LaneList,
	LaneSearch,
	type LaneTabOption,
	LaneTabs,
	type LaneToggleOption,
	LaneToggleRow,
} from "@projective/ui/navigation";
import { Tooltip } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import type { IconName } from "@projective/ui/icons";
import type { CalendarEvent, CalendarEventKind, SchedulePage } from "@projective/types/scheduling";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { AvailabilityBlock, AvailabilityTemplates } from "../components/AvailabilityManager.tsx";
import { CalendarFilterFacets } from "../components/CalendarFilterFacets.tsx";
import { openStudio } from "@features/catalogue/core/availability-store.ts";
import { providerMarkFor } from "../components/provider-marks.tsx";
import {
	activeFilterCount,
	calendarFocus,
	calendarPage,
	calendarQuery,
	importedEvents,
	kindsOnPage,
	laneSpotlight,
	requestCreate,
	resetFilters,
	selectedEventId,
	selectEvent,
	showOnlyKind,
	soleVisibleKind,
	sourceIsVisible,
	visibleEvents,
} from "../core/calendar-state.ts";

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
 * **What is coming and when I am available are two subjects, so they are two tabs** rather than one
 * stack in which each got half the lane's height. The strip is the shared {@link LaneTabs}, the same
 * control the `/projects` feed and the `/catalogue` console use, so a reader who has switched tabs
 * once on this product has switched them everywhere.
 *
 * **The list scrolls on its own.** It is every entry the filters leave, in order, rather than a window
 * that followed the grid's focus — a list that re-anchored whenever the grid scrolled was the grid
 * scrolling it by proxy. The two views meet only on a pick: a row moves the grid onto its entry, and
 * an entry picked on the grid brings its row to the middle of the list ({@link selectEvent}).
 *
 * **Filter sits beside the search**, the `/projects` anatomy: the shared {@link LaneFilterPopover} over
 * {@link CalendarFilterFacets}, narrowing the grid and this list together.
 *
 * **The lane offers no New event and no view switch.** Both live in the middle-nav footer band, which
 * renders at every width — including the widths where the shell removes this lane entirely — and two
 * triggers for one action inside one region is the duplication the region contract exists to prevent
 * (root CLAUDE.md §8 Decisions #60/#63).
 */
export interface CalendarLaneProps {
	/** The SSR page, so the lane paints its first frame with the same data the grid has. */
	initial: SchedulePage | null;
}

/** The registry glyph each kind is drawn with in the quick row. */
const KIND_ICON: Record<CalendarEventKind, IconName> = {
	deadline: "flag",
	milestone: "star",
	sync: "members",
	session: "video",
	booking: "check",
	availability: "calendar-plus",
	busy: "lock",
	holiday: "globe",
	general: "tag",
};

/** Which half of the lane the tab strip is showing. */
type LanePanel = "events" | "availability";

/**
 * The two lane panels.
 *
 * `Availability` is the manager that used to be a permanent block pinned under the upcoming list, so
 * the lane described two subjects at once and each got half the height. As a tab it gets the whole
 * panel, and the events list stops being squeezed by a weekly table it is unrelated to.
 */
const LANE_TABS: readonly LaneTabOption<LanePanel>[] = [
	{ value: "events", label: "Events" },
	{ value: "availability", label: "Availability" },
];

export default function CalendarLane(props: CalendarLaneProps): JSX.Element {
	const collapsed = useSignal(false);
	/**
	 * Which panel the tab strip is showing.
	 *
	 * A signal on this island rather than a module one in `calendar-state`: it is one region's own view
	 * state with no second reader. The header band's availability control does NOT switch it — below
	 * 767px the shell removes the lane entirely, so selecting a tab nobody can see would be no answer
	 * at all, and that control opens the dialog instead (which this island keeps mounted for exactly
	 * that reason). A `useSignal` survives every re-render of this tree — the minute tick, a republished
	 * page, a filter move — where a plain local would be reset by each of them.
	 */
	const panel = useSignal<LanePanel>("events");
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
	const listed = visibleEvents(all).sort((a, b) => a.start - b.start);
	const selected = selectedEventId.value;

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
		if (panel.peek() !== "events") panel.value = "events";
		// A task, so a tab switch above has rendered the list before it is measured.
		setTimeout(() => centreRow(flashing, scrollBehaviorFor()), 0);
	}, [flashing]);

	/*
	 * The quick row offers only the kinds actually ON the page, so it never presents a filter that
	 * would empty the list — and it is SINGLE-select, because the shared lane chrome names every
	 * toggle "Show {label} only" and a control has to mean what its accessible name says. It writes
	 * the same `hiddenKinds` deny list the header's checkboxes read, so the two are one axis with two
	 * entry points rather than two filters that can disagree.
	 */
	const present = kindsOnPage(all);
	const kindToggles: readonly LaneToggleOption<CalendarEventKind>[] = present.map((kind) => ({
		key: kind,
		label: CALENDAR_KIND_LABEL[kind],
		icon: <Icon name={KIND_ICON[kind]} />,
	}));
	const solo = soleVisibleKind(present);

	return (
		<div class="cal-lanewrap">
			{/* Collapsed presentation — revealed by CSS at the rail density. */}
			<div class="cal-rail">
				<div class="cal-rail__items" role="list">
					<Tooltip content="Today" placement="right">
						<button
							type="button"
							class="cal-rail__item"
							aria-label="Go to today"
							onClick={() => (calendarFocus.value = Date.now())}
						>
							<Icon name="calendar" />
						</button>
					</Tooltip>
					<Tooltip content="Availability" placement="right">
						<button
							type="button"
							class="cal-rail__item"
							aria-label="Availability"
							aria-haspopup="dialog"
							onClick={() => void openStudio(tz)}
						>
							<Icon name="clock" />
						</button>
					</Tooltip>
				</div>

				<div class="cal-rail__bottom">
					<Tooltip content="New event" placement="right">
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

					{kindToggles.length > 1
						? (
							<LaneToggleRow
								label="Event type"
								options={kindToggles}
								active={solo ? [solo] : []}
								onToggle={(k) => showOnlyKind(k, present)}
							/>
						)
						: null}

					{
						/*
						 * The switch sits at the FOOT of the head, not its peak, because everything above it —
						 * the mini-month, find-in-calendar, the kind row — narrows the GRID as well and so
						 * belongs to neither panel. Putting the strip last makes it govern exactly the region
						 * it precedes, and its underline lands on the head's own hairline rather than drawing a
						 * second rule a few pixels from it (§B.4).
						 */
					}
					<LaneTabs<LanePanel>
						label="Lane view"
						value={panel.value}
						options={LANE_TABS}
						onSelect={(v) => (panel.value = v)}
					/>
				</LaneHead>

				{panel.value === "events"
					? (
						<LaneList label="Events" role="tabpanel" class="cal-lane__list">
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
										tz={tz}
										selected={e.id === selected}
										flashing={e.id === flashing}
									/>
								))}
						</LaneList>
					)
					: (
						<div class="cal-lane__panel" role="tabpanel" aria-label="Availability">
							<AvailabilityTemplates timezone={page?.availability?.timezone ?? tz} />
							{page?.availability
								? (
									<AvailabilityBlock
										availability={page.availability}
										onConfigure={() => void openStudio(page.availability?.timezone ?? tz)}
									/>
								)
								: (
									<LaneEmpty
										title="No hours set"
										note="Your working hours, call windows and booked leave will show here."
									/>
								)}
						</div>
					)}

				<LaneFooter>
					<LaneCollapseButton
						collapsed={collapsed.value}
						icon={<SidebarToggleIcon />}
						onToggle={() => setCollapsed(!collapsed.value)}
					/>
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
	{ event, tz, selected, flashing }: {
		event: CalendarEvent;
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
		: `${calendarTime.fmtDayLabel(event.start, tz)} · ${
			calendarTime.fmtRange(event.start, event.end, tz, true)
		}`;
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
			{event.meta ? <span class="cal-up__meta">{event.meta}</span> : null}
		</span>
	);

	/*
	 * The row is a PICK, not a link: it opens the entry beside the grid and moves the grid onto it.
	 * Where the entry lives (its engagement, `href`) is one step further, from the details it opens.
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
				onClick={() => selectEvent(event, "list")}
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
