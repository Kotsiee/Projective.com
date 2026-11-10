import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "@features/calendar/styles/calendar-page.css";
import "@features/calendar/styles/calendar-chrome.css";
import { Calendar } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import { awaitsAnswer, type CalendarEvent, type CalendarPage } from "@projective/types/scheduling";
import type { WorkspaceKind } from "@projective/types/workspace";
import { EventModal } from "@features/calendar/components/EventModal.tsx";
import { renderCalendarSource } from "@features/calendar/components/provider-marks.tsx";
import { type EventMode, eventStack } from "@features/calendar/core/event-view.ts";
import {
	type EventAccess,
	readDevSeam,
	resolveEventAccess,
	subscribeDevSeam,
} from "@features/calendar/core/event-access.ts";
import { deepLinkedEvent, invitationsFiltered } from "@features/calendar/core/event-deep-link.ts";
import {
	calendarFocus,
	calendarPage,
	calendarPresent,
	calendarSnapZoom,
	calendarView,
	calendarZoom,
	eventReread,
	focusedAt,
	gridSpotlight,
	inspectInPanel,
	invitationsOnly,
	leavingEvents,
	selectedEventId,
	selectEvent,
	sourceIsVisible,
	timelineZoom,
	visibleEvents,
} from "@features/calendar/core/calendar-state.ts";
import { useCalendarViewMemory } from "@features/calendar/hooks/useCalendarViewMemory.ts";
import {
	entityAgendaPage,
	entityCalendarView,
	entityEventTarget,
} from "../core/calendar-module-model.ts";

/**
 * EntityCalendarScreen — a team's or business's Calendar module (Decisions #308, #403): the union of the
 * entity's projects' calendars, laid out as `/calendar` is.
 *
 * The page is read server-side by the `[module]` route (`resolveEntityCalendar`), as the viewer, so
 * every meeting, stage due date and ticket deadline on it is one RLS let them see on its own project.
 * This is the BODY and nothing but the grid: the console's header, footer and panel slots mount
 * `/calendar`'s own header band (the period trail, Go to now, the panel toggle), footer rig (the zoom
 * ruler and Export) and panel (Month, and an Events tab holding the list the `/calendar` lane carries,
 * since this console's lane is its rail). They render in the frame, outside this tree, and read the
 * page through `calendarPage`, which this island publishes — one reader, one answer.
 *
 * It creates nothing: an entry belongs to one project, so new ones are added on that project's
 * calendar. A pick opens in the panel's inspector, and its RSVP and reschedule writes — there or in the
 * {@link EventModal} it opens — are addressed to the entry's own project (`entityEventTarget`), where the
 * server re-resolves it.
 */

// #region Props
export interface EntityCalendarScreenProps {
	kind: WorkspaceKind;
	name: string;
	/** The union, or `null` when it could not be read. */
	initial: CalendarPage | null;
	/** Why it could not be read. */
	initialError: string | null;
	/** How many projects the union was read across. */
	projectCount: number;
}
// #endregion

/** An answer re-read on its project keeps the union's attribution and its meta line. */
function adopt(events: readonly CalendarEvent[], next: CalendarEvent): CalendarEvent[] {
	return events.map((e) =>
		e.id === next.id ? { ...next, projectId: e.projectId, meta: e.meta } : e
	);
}

export default function EntityCalendarScreen(props: EntityCalendarScreenProps): JSX.Element {
	const view = entityCalendarView(props);
	const page = props.initial ? entityAgendaPage(props.initial) : null;
	const events = useSignal<CalendarEvent[]>(page?.events ?? []);
	const viewerIsClient = props.initial?.viewerIsClient ?? props.kind === "business";
	const access = useSignal<EventAccess>(resolveEventAccess({ viewerIsClient }, null));

	useCalendarViewMemory();

	useEffect(() => {
		invitationsOnly.value = invitationsFiltered(globalThis.location?.search ?? "");
		if (page) calendarPage.value = page;
		const apply = () => {
			access.value = resolveEventAccess({ viewerIsClient }, readDevSeam());
		};
		apply();
		// `?event=<id>` opens that occurrence in the inspector, on its week, when it is on the calendar.
		const linked = deepLinkedEvent(globalThis.location?.search ?? "", events.peek());
		if (linked) {
			calendarFocus.value = linked.start;
			inspectInPanel(linked);
		}
		const unsubscribe = subscribeDevSeam(apply);
		// The page is a module signal the frame's regions share, so it goes when this tree does.
		return () => {
			unsubscribe();
			calendarPage.value = null;
			selectedEventId.value = null;
			eventStack.close();
		};
	}, []);

	/** The session's answers travel to the regions that read the page. */
	useSignalEffect(() => {
		const list = events.value;
		const current = calendarPage.peek();
		if (current) calendarPage.value = { ...current, events: list };
	});

	/** An entry the inspector re-read: an answer given in the panel. */
	useSignalEffect(() => {
		const next = eventReread.value;
		if (!next) return;
		eventReread.value = null;
		events.value = adopt(events.peek(), next);
	});

	if (!page) {
		return (
			<div class="cal-surface cal-surface--full cal-surface--empty" data-kind={props.kind}>
				<p class="cal-surface__empty" role="alert">{props.initialError ?? view.failedNote}</p>
			</div>
		);
	}

	const leaving = leavingEvents.value;
	// The engine knows nothing of RSVPs, so the answer waiting on the reader becomes its two words.
	const shown = visibleEvents(events.value).map((e) =>
		awaitsAnswer(e) || leaving.includes(e.id)
			? { ...e, ghost: awaitsAnswer(e), leaving: leaving.includes(e.id) }
			: e
	);
	const open = eventStack.top.value;
	const framed = open ? events.value.find((e) => e.id === open.id) ?? null : null;
	const target = framed ? entityEventTarget(framed) : null;
	const renderSource = (source: string) =>
		sourceIsVisible(source) ? renderCalendarSource(source) : null;

	return (
		<div class="cal-surface cal-surface--full" data-kind={props.kind}>
			{events.value.length === 0
				? (
					<Message severity="info" size="sm" class="cal-surface__notice">
						{view.emptyNote}
					</Message>
				)
				: null}
			<Calendar
				events={shown}
				spotlight={gridSpotlight}
				present={calendarPresent}
				// The entry opens in the panel beside the grid, so the engine's popover would repeat it.
				directOpen
				timezone={page.timezone}
				view={calendarView.value}
				zoom={calendarZoom}
				timelineZoom={timelineZoom}
				snapZoom={calendarSnapZoom.value}
				focus={focusedAt(page)}
				hideSidePanel
				hideHeader
				canCreate={false}
				renderSource={renderSource}
				storageKey="pj.calendar.entity"
				onViewChange={(v) => (calendarView.value = v)}
				onFocusChange={(ms) => (calendarFocus.value = ms)}
				onOpenEvent={(ev) => {
					const event = ev as CalendarEvent;
					// An entry the union could not attribute has no project to answer on, so it opens where
					// it lives instead of in an inspector whose every action would be refused.
					if (entityEventTarget(event)) selectEvent(event, "grid");
					else if (event.href) globalThis.location.assign(event.href);
				}}
			/>

			{open && framed && target
				? (
					<EventModal
						key={open.uid}
						uid={open.uid}
						mode={(open.input?.mode ?? "view") as EventMode}
						initialTab={open.input?.tab}
						event={framed}
						tz={page.timezone}
						hour12
						nowMs={page.now}
						access={access.value}
						target={target}
						createKinds={[]}
						canBook={false}
						onClose={() => eventStack.close()}
						onSubmit={(ev) => {
							events.value = events.value.map((e) =>
								e.id === ev.id ? { ...ev, projectId: e.projectId } : e
							);
						}}
						onBook={() => {}}
						onServerUpdate={(ev) => {
							events.value = adopt(events.value, ev);
						}}
					/>
				)
				: null}
		</div>
	);
}
