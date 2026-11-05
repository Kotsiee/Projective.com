import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { calendarTime, maskLabel, MiniMonth, useNowTick } from "@projective/ui/calendar";
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
	/** The entry `?event=` names, so a linked entry paints in the first byte too, with no swap. */
	linkedEventId?: string | null;
}

/**
 * CalendarPanel — the `/calendar` hub's middle-nav PANEL: the inspector for the picked entry, and the
 * month navigator.
 *
 * From 1280px it docks in the frame and the header band's toggle opens and closes it through the
 * shell's shared panel state, exactly as `/messages` and `/catalogue/[id]` do. Below that the same two
 * tabs arrive in a drawer: a pick opens it (`inspectInPanel`), and it leaves more of the grid in view
 * than the event modal it replaces.
 *
 * Event is the entry picked on the grid or in the lane's list, and Month the navigator, so the reader
 * moves between the details and the navigator without losing either. A pick switches to Event; the tab
 * strip switches back.
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
	/** Off until the mount below has moved a linked entry into the shared selection. */
	const settled = useSignal(false);

	useEffect(() => {
		if (calendarFocus.value) monthMs.value = calendarFocus.value;
	}, [calendarFocus.value]);

	const page = calendarPage.value ?? props.initial;
	const tz = page?.timezone ?? "UTC";
	const all = [...(page?.events ?? []), ...importedEvents.value];
	const linked = props.linkedEventId ? all.find((e) => e.id === props.linkedEventId) ?? null : null;

	useEffect(() => {
		if (linked && !selectedEventId.peek()) {
			selectedEventId.value = linked.id;
			panelTab.value = "event";
		}
		settled.value = true;
	}, []);

	const id = settled.value ? selectedEventId.value : linked?.id ?? null;
	const tab = settled.value || !linked ? panelTab.value : "event";
	const picked = id ? all.find((e) => e.id === id) ?? null : null;

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

	const views = (viewId: string) => (
		<>
			<LaneTabs<"event" | "month">
				label="Panel view"
				value={tab}
				options={PANEL_TABS}
				panelId={viewId}
				onSelect={(v) => (panelTab.value = v)}
				class="cal-panel__tabs"
			/>
			<div
				id={viewId}
				class="cal-panel__view"
				role="tabpanel"
				aria-labelledby={`${viewId}-tab-${tab}`}
			>
				{tab === "month"
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
		</>
	);

	return (
		<>
			<aside id={CALENDAR_PANEL_ID} class="cal-panel" aria-label="Event and month">
				{views("cal-panel-view")}
				{
					/*
					 * A pick does not move focus, which stays on the row or the grid the reader is working
					 * through, so the inspector says what it now holds instead.
					 */
				}
				<p class="ui-visually-hidden" role="status">
					{picked && tab === "event"
						? `Showing ${picked.masked ? maskLabel(picked.status) : picked.title}`
						: ""}
				</p>
			</aside>
			{!inflow && (
				<Drawer
					visible={contextDrawerOpen}
					position="right"
					header="Event and month"
					size="min(22rem, 100vw)"
					class="cal-panel-drawer"
				>
					<div class="cal-panel cal-panel--drawer">{views("cal-drawer-view")}</div>
				</Drawer>
			)}
		</>
	);
}
