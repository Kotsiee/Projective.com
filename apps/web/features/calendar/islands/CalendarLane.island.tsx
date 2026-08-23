import type { JSX, VNode } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { MiniMonth } from "@projective/ui/calendar";
import { CALENDAR_KIND_LABEL, calendarTime, useNowTick } from "@projective/ui/calendar";
import {
	LaneBar,
	LaneCollapseButton,
	LaneEmpty,
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
import type { CalendarViewMode } from "@projective/ui/calendar";
import type { CalendarEvent, CalendarEventKind, SchedulePage } from "@projective/types/scheduling";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { AvailabilityBlock, AvailabilityDialog } from "../components/AvailabilityManager.tsx";
import { providerMarkFor } from "../components/provider-marks.tsx";
import {
	availabilityOpen,
	CALENDAR_VIEWS,
	calendarFocus,
	calendarPage,
	calendarQuery,
	calendarView,
	importedEvents,
	kindsOnPage,
	requestCreate,
	showOnlyKind,
	soleVisibleKind,
	sourceIsVisible,
	visibleEvents,
} from "../core/calendar-state.ts";

/**
 * CalendarLane — the middle-nav lane for `/calendar`: where in time am I, what is coming, and when
 * am I available.
 *
 * Built from the shared `@projective/ui/navigation` lane chrome, so it reads as the same control set
 * as the `/projects` feed, the `/messages` inbox and the `/wallet` rail rather than a fourth
 * lookalike. Both presentations — the expanded stack and the collapsed icon rail — are always in the
 * DOM and CSS reveals exactly one, keyed off the splitter's `data-mode`. A client width observer
 * would paint the wrong one for a frame on every load.
 *
 * The mini-month is the package's own {@link MiniMonth}, not a bespoke redraw. Decisions #48 and #53
 * both hand-rolled one because `calendar.css` ships only through the calendar ISLAND's bundle and
 * those surfaces did not mount it — here the grid is on the very same route, and this island imports
 * the package barrel besides, so the sheet is in the graph twice over and the real control is
 * simply reusable.
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
 * **The lane offers no New event and no view switch.** Both live in the middle-nav footer band, which
 * renders at every width — including the widths where the shell removes this lane entirely — and two
 * triggers for one action inside one region is the duplication the region contract exists to prevent
 * (root CLAUDE.md §8 Decisions #60/#63).
 */
export interface CalendarLaneProps {
	/** The SSR page, so the lane paints its first frame with the same data the grid has. */
	initial: SchedulePage | null;
}

/** How far ahead the upcoming list looks. Beyond a fortnight the list stops being a list. */
const UPCOMING_WINDOW_MS = 14 * 86_400_000;
/** How many entries the list shows before it becomes a wall rather than a glance. */
const UPCOMING_MAX = 12;

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

/**
 * The registry glyph each view mode is drawn with on the collapsed rail.
 *
 * The registry carries no day/week/month trio, and the calendar package's own three glyphs are not
 * exported from its barrel — so rather than authoring a fourth icon family (§B.7, the whole point of
 * the registry), these borrow three shapes that already mean the right thing: a day is one column of
 * hours (`list`), a week is a grid of them (`grid`), a month is the calendar page itself. The words
 * come from {@link CALENDAR_VIEWS}, which the footer rig's switch reads too.
 */
const VIEW_ICON: Record<CalendarViewMode, IconName> = {
	day: "list",
	week: "grid",
	month: "calendar",
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
	 * The wall clock, live.
	 *
	 * The engine's own ticker, for the two reasons it exists: `mounted` keeps the marker off the SSR
	 * paint (`Date.now()` on the server and again on the client are two different instants, and a
	 * mini-month marking a different day in each is a hydration mismatch on the one cell a reader
	 * looks for first), and the interval means the marker actually moves at midnight. Computed ONCE in
	 * a `[]` effect it never did — a calendar left open overnight kept yesterday circled.
	 */
	const { now, mounted } = useNowTick();
	/**
	 * "Today", QUANTISED to a day and resolved in the PAGE's zone.
	 *
	 * A computed rather than a render-body expression for the reason the engine gives for its own: a
	 * computed notifies only when its VALUE changes, so the minute tick is silent until midnight
	 * instead of re-rendering the 42-cell mini-month, the upcoming list and the availability block
	 * once a minute to move nothing.
	 *
	 * The zone is read INSIDE the computed, from the same `calendarPage ?? props.initial` pair every
	 * other read in this component uses. Reading it outside would close over a stale zone: the page is
	 * published by the BODY island and mount order between two hydration roots is not guaranteed, so
	 * the lane resolved "today" in UTC when it mounted first — the wrong day for the hours UTC and the
	 * page's zone disagree — and, with no signal of its own to invalidate on, never corrected it.
	 */
	const todayMs = useComputed(() =>
		mounted.value
			? calendarTime.startOfDay(
				now.value,
				calendarPage.value?.timezone ?? props.initial?.timezone ?? "UTC",
			)
			: null
	);
	/**
	 * Which month the mini-map is SHOWING, which is not the same as which instant is focused.
	 *
	 * Stepping the mini-map browses ahead without moving the grid — the same separation the engine's
	 * own side panel makes. Collapsing the two would make every glance at next month a navigation.
	 */
	const monthMs = useSignal<number>(calendarFocus.peek());
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

	useEffect(() => {
		// The splitter owns the width; the lane mirrors its state only so the toggle glyph is right.
		const el = document.querySelector(".ui-splitter") as HTMLElement | null;
		if (el) collapsed.value = el.dataset.mode === "collapsed";
	}, []);

	// A pick, a nav step or a scroll that lands in another month brings the mini-map with it.
	useEffect(() => {
		monthMs.value = calendarFocus.value;
	}, [calendarFocus.value]);

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
	const shown = visibleEvents(all);

	/*
	 * The upcoming list is anchored on the FOCUSED instant, not on the wall clock.
	 *
	 * Anchoring it on "now" would leave the lane describing this afternoon while the grid beside it
	 * showed a week in September — two regions answering the same question differently. It follows
	 * the reader's own position instead, which is what makes it a companion to the grid rather than a
	 * second, competing agenda.
	 */
	const from = calendarFocus.value;
	const upcoming = shown
		.filter((e) => e.end > from && e.start < from + UPCOMING_WINDOW_MS)
		.sort((a, b) => a.start - b.start)
		.slice(0, UPCOMING_MAX);

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
					{CALENDAR_VIEWS.map((v) => (
						<Tooltip content={`${v.label} view`} placement="right" key={v.value}>
							<button
								type="button"
								class="cal-rail__item"
								data-active={calendarView.value === v.value ? "true" : "false"}
								aria-label={`${v.label} view`}
								aria-pressed={calendarView.value === v.value ? "true" : "false"}
								onClick={() => (calendarView.value = v.value)}
							>
								<Icon name={VIEW_ICON[v.value]} />
							</button>
						</Tooltip>
					))}
					<Tooltip content="Working hours and leave" placement="right">
						<button
							type="button"
							class="cal-rail__item"
							aria-label="Working hours and leave"
							aria-haspopup="dialog"
							onClick={() => (availabilityOpen.value = true)}
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
					<Tooltip content="Expand lane" placement="right">
						<button
							type="button"
							class="cal-rail__toggle"
							aria-label="Expand lane"
							onClick={() => setCollapsed(false)}
						>
							<SidebarToggleIcon />
						</button>
					</Tooltip>
				</div>
			</div>

			{/* Expanded presentation. */}
			<div class="cal-lane">
				<LaneHead class="cal-lane__head">
					<MiniMonth
						monthMs={monthMs.value}
						focusMs={calendarFocus.value}
						tz={tz}
						view={calendarView.value}
						todayMs={todayMs.value}
						onPick={(day) => (calendarFocus.value = day)}
						onMonthStep={(d) => (monthMs.value = calendarTime.addZonedMonths(monthMs.value, d, tz))}
					/>

					<LaneBar>
						<LaneSearch
							value={calendarQuery.value}
							placeholder="Search your calendar"
							label="Search your calendar"
							icon={<Icon name="search" />}
							onInput={(v) => (calendarQuery.value = v)}
						/>
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
							{upcoming.length === 0
								? (
									<LaneEmpty
										title="Nothing coming up"
										note="Nothing in the next fortnight from where you are looking."
									/>
								)
								: upcoming.map((e) => <UpcomingRow key={e.id} event={e} tz={tz} />)}
						</LaneList>
					)
					: (
						<div class="cal-lane__panel" role="tabpanel" aria-label="Availability">
							{page?.availability
								? (
									<AvailabilityBlock
										availability={page.availability}
										onConfigure={() => (availabilityOpen.value = true)}
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

			{page?.availability
				? <AvailabilityDialog open={availabilityOpen} availability={page.availability} />
				: null}
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
function UpcomingRow({ event, tz }: { event: CalendarEvent; tz: string }): JSX.Element {
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

	return (
		<div class="cal-up" data-kind={event.kind}>
			{event.href ? <a class="cal-up__link" href={event.href}>{row}</a> : row}
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
