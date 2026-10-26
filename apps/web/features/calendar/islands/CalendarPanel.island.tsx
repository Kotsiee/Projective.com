import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { calendarTime, MiniMonth, useNowTick } from "@projective/ui/calendar";
import { Drawer } from "@projective/ui/feedback";
import { LaneEmpty, type LaneTabOption, LaneTabs, useMediaQuery } from "@projective/ui/navigation";
import type { SchedulePage } from "@projective/types/scheduling";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
} from "@web/features/shell/core/context-panel-state.ts";
import { EventSummary } from "../components/EventSummary.tsx";
import {
	CALENDAR_PANEL_ID,
	calendarFocus,
	calendarPage,
	calendarView,
	focusedAt,
	importedEvents,
	panelTab,
	selectedEventId,
} from "../core/calendar-state.ts";

const PANEL_TABS: readonly LaneTabOption<"event" | "month">[] = [
	{ value: "event", label: "Event" },
	{ value: "month", label: "Month" },
];

/** Props for {@link CalendarPanel}. */
export interface CalendarPanelProps {
	/** The SSR page, so the month paints in the first byte on the page's own clock and zone. */
	initial: SchedulePage | null;
}

/**
 * CalendarPanel — the `/calendar` hub's middle-nav PANEL: the picked event, and the month navigator.
 *
 * From 1280px it docks in the frame and the header band's toggle opens and closes it through the
 * shell's shared panel state, exactly as `/messages` and `/catalogue/[id]` do. There it holds two
 * tabs — Event, the entry picked on the grid or in the lane's list, and Month — so the reader moves
 * between the details and the navigator without losing either. A pick switches to Event
 * ({@link selectEvent}); the tab strip switches back.
 *
 * Below 1280px the panel is a drawer, and a pick opens the event modal instead (a drawer over the
 * grid the reader just clicked would hide the thing they picked), so the drawer carries the month
 * alone.
 *
 * Browsing months here does not move the grid; picking a day does, through {@link calendarFocus},
 * and a pick, a step or a scroll that lands in another month brings the navigator with it.
 */
export default function CalendarPanel(props: CalendarPanelProps): JSX.Element {
	const inflow = useMediaQuery(CONTEXT_PANEL_INFLOW_QUERY);
	const { now, mounted } = useNowTick();
	const todayMs = useComputed(() =>
		mounted.value
			? calendarTime.startOfDay(
				now.value,
				calendarPage.value?.timezone ?? props.initial?.timezone ?? "UTC",
			)
			: null
	);
	const monthMs = useSignal<number>(calendarFocus.peek() || props.initial?.now || Date.now());

	useEffect(() => {
		if (calendarFocus.value) monthMs.value = calendarFocus.value;
	}, [calendarFocus.value]);

	const page = calendarPage.value ?? props.initial;
	const tz = page?.timezone ?? "UTC";
	const id = selectedEventId.value;
	const picked = id
		? [...(page?.events ?? []), ...importedEvents.value].find((e) => e.id === id) ?? null
		: null;

	const month = () => (
		<div class="cal-panel__mini">
			<MiniMonth
				monthMs={monthMs.value}
				focusMs={focusedAt(page)}
				tz={tz}
				view={calendarView.value}
				todayMs={todayMs.value}
				onPick={(day) => (calendarFocus.value = day)}
				onMonthStep={(d) => (monthMs.value = calendarTime.addZonedMonths(monthMs.value, d, tz))}
			/>
		</div>
	);

	return (
		<>
			<aside id={CALENDAR_PANEL_ID} class="cal-panel" aria-label="Event and month">
				<LaneTabs<"event" | "month">
					label="Panel view"
					value={panelTab.value}
					options={PANEL_TABS}
					panelId="cal-panel-view"
					onSelect={(v) => (panelTab.value = v)}
					class="cal-panel__tabs"
				/>
				<div
					id="cal-panel-view"
					class="cal-panel__view"
					role="tabpanel"
					aria-labelledby={`cal-panel-view-tab-${panelTab.value}`}
				>
					{panelTab.value === "month"
						? month()
						: picked
						? <EventSummary key={picked.id} event={picked} tz={tz} />
						: (
							<LaneEmpty
								title="No event picked"
								note="Pick an event on the calendar or in the list to see it here."
							/>
						)}
				</div>
			</aside>
			{!inflow && (
				<Drawer
					visible={contextDrawerOpen}
					position="right"
					header="Month navigator"
					size="min(22rem, 100vw)"
					class="cal-panel-drawer"
				>
					<div class="cal-panel cal-panel--drawer">{month()}</div>
				</Drawer>
			)}
		</>
	);
}
