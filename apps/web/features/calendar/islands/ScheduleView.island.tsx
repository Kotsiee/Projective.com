import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-page.css";
import { Calendar } from "@projective/ui/calendar";
import type { CalendarRange } from "@projective/ui/calendar";
import type { CalendarEvent, SchedulePage } from "@projective/types/scheduling";
import { EventDialog } from "../components/EventDialog.tsx";
import { ScheduleService } from "../core/ScheduleService.ts";

/** Reference focus instant — matches the fixtures' fixed clock so the schedule opens on the seeded week. */
const FOCUS = Date.parse("2026-07-17T16:20:00Z");

/**
 * ScheduleView — the body island for the schedule surfaces: `/[handle]/availability` and
 * `/view/[entity]/schedule`. Hydrates from the SSR `initial` {@link SchedulePage} (weekly working hours +
 * timezone + blackouts + privacy-masked bookable/busy blocks + public group sessions) and renders the
 * `@projective/ui/calendar` engine with the availability overlay + the left availability panel. The grid's
 * selection actions open the booking flow (§Part 2.2); a booked slot is session-local (stub, checkout
 * deferred). Dumb: it fetches only via the thin {@link ScheduleService} when SSR produced nothing.
 */
export interface ScheduleViewProps {
	scope: "availability" | "schedule";
	initial: SchedulePage | null;
	/** For the fallback refetch when SSR produced nothing. */
	handle?: string;
	entityId?: string;
	/** Fill the whole page (the `/[handle]/availability` full-page surface) instead of an embedded block. */
	fullPage?: boolean;
}

export default function ScheduleView(props: ScheduleViewProps): JSX.Element {
	const page = useSignal<SchedulePage | null>(props.initial);
	const events = useSignal<CalendarEvent[]>(props.initial?.events ?? []);
	const dialogOpen = useSignal(false);
	const draftRange = useSignal<CalendarRange | null>(null);
	const activeEvent = useSignal<CalendarEvent | null>(null);

	useEffect(() => {
		if (props.initial) return;
		void (async () => {
			const res = props.scope === "availability" && props.handle
				? await ScheduleService.availability(props.handle)
				: props.entityId
				? await ScheduleService.schedule(props.entityId)
				: null;
			if (res && res.ok && res.data) {
				page.value = res.data.page;
				events.value = res.data.page.events;
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const surfaceMod = props.fullPage ? "cal-surface--full" : "cal-surface--schedule";
	const p = page.value;
	if (!p) {
		return (
			<div class={`cal-surface ${surfaceMod} cal-surface--empty`}>
				<p class="cal-surface__empty">This schedule couldn’t be loaded.</p>
			</div>
		);
	}

	return (
		<div class={`cal-surface ${surfaceMod}`}>
			<Calendar
				events={events.value}
				availability={p.availability}
				timezone={p.timezone}
				view="week"
				focus={FOCUS}
				title={p.subtitle ?? p.title}
				integrations={p.integrations}
				canCreate={p.viewerCanBook}
				storageKey="pj.calendar.schedule"
				onSelectRange={(range) => {
					if (!p.viewerCanBook) return;
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
				mode="schedule"
				range={draftRange.value}
				event={activeEvent.value}
				canBook={p.viewerCanBook}
				onCreate={(ev) => (events.value = [...events.value, ev])}
				onBook={(ev) => (events.value = [...events.value, ev])}
			/>
		</div>
	);
}
