import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-page.css";
import { Calendar } from "@projective/ui/calendar";
import type { CalendarRange } from "@projective/ui/calendar";
import type { CalendarEvent, CalendarPage } from "@projective/types/scheduling";
import { EventDialog } from "../components/EventDialog.tsx";
import { ScheduleService } from "../core/ScheduleService.ts";

/** Reference focus instant — matches the fixtures' fixed clock so the calendar opens on the seeded week. */
const FOCUS = Date.parse("2026-07-17T16:20:00Z");

/**
 * ProjectCalendar — the body island for `/projects/[id]/calendar` and `/projects/[id]/[channel]/calendar`.
 * Hydrates from the SSR `initial` {@link CalendarPage} (task deadlines · review milestones · stage syncs ·
 * sessions), renders the reusable `@projective/ui/calendar` engine, and embeds the create/booking modal
 * into the grid's selection actions (§Part 2.1). Dumb: it fetches only via the thin {@link ScheduleService}
 * when SSR produced nothing; created events are session-local (stub, persistence deferred).
 */
export interface ProjectCalendarProps {
	scope: "project" | "channel";
	projectId: string;
	channelId?: string;
	initial: CalendarPage | null;
}

export default function ProjectCalendar(props: ProjectCalendarProps): JSX.Element {
	const page = useSignal<CalendarPage | null>(props.initial);
	const events = useSignal<CalendarEvent[]>(props.initial?.events ?? []);
	const dialogOpen = useSignal(false);
	const draftRange = useSignal<CalendarRange | null>(null);
	const activeEvent = useSignal<CalendarEvent | null>(null);

	useEffect(() => {
		if (props.initial) return;
		void (async () => {
			const res = await ScheduleService.calendar(props.projectId, props.channelId);
			if (res.ok && res.data) {
				page.value = res.data.page;
				events.value = res.data.page.events;
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const p = page.value;
	if (!p) {
		return (
			<div class="cal-surface cal-surface--empty">
				<p class="cal-surface__empty">This calendar couldn’t be loaded.</p>
			</div>
		);
	}

	return (
		<div class={`cal-surface${props.scope === "channel" ? " cal-surface--channel" : ""}`}>
			<Calendar
				events={events.value}
				timezone={p.timezone}
				view="week"
				focus={FOCUS}
				title={p.title}
				integrations={p.integrations}
				canCreate={p.canCreate}
				storageKey="pj.calendar.project"
				onSelectRange={(range) => {
					draftRange.value = range;
					activeEvent.value = null;
					dialogOpen.value = true;
				}}
				onOpenEvent={(ev) => {
					activeEvent.value = ev as CalendarEvent;
					draftRange.value = null;
					dialogOpen.value = true;
				}}
			/>
			<EventDialog
				open={dialogOpen}
				tz={p.timezone}
				mode="calendar"
				range={draftRange.value}
				event={activeEvent.value}
				onCreate={(ev) => (events.value = [...events.value, ev])}
			/>
		</div>
	);
}
