import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-chrome.css";
import { calendarTime, MiniMonth, useNowTick } from "@projective/ui/calendar";
import { Drawer } from "@projective/ui/feedback";
import { useMediaQuery } from "@projective/ui/navigation";
import type { SchedulePage } from "@projective/types/scheduling";
import {
	CONTEXT_PANEL_INFLOW_QUERY,
	contextDrawerOpen,
} from "@web/features/shell/core/context-panel-state.ts";
import {
	CALENDAR_PANEL_ID,
	calendarFocus,
	calendarPage,
	calendarView,
	focusedAt,
} from "../core/calendar-state.ts";

/** Props for {@link CalendarPanel}. */
export interface CalendarPanelProps {
	/** The SSR page, so the month paints in the first byte on the page's own clock and zone. */
	initial: SchedulePage | null;
}

/**
 * CalendarPanel — the `/calendar` hub's middle-nav PANEL: the month navigator.
 *
 * From 1280px it docks in the frame and the header band's toggle opens and closes it through the
 * shell's shared panel state, exactly as `/messages` and `/catalogue/[id]` do; below that the same
 * month slides over in a drawer. The month sits centred in the panel while it is the panel's only
 * content.
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
			<aside id={CALENDAR_PANEL_ID} class="cal-panel" aria-label="Month navigator">
				{month()}
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
