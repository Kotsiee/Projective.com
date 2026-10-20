import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/workspace.css";
import "@features/calendar/styles/calendar-page.css";
import { Calendar } from "@projective/ui/calendar";
import type { CalendarEvent, CalendarPage } from "@projective/types/scheduling";
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
import { entityCalendarView, entityEventTarget } from "../core/calendar-module-model.ts";

/**
 * EntityCalendarScreen — a team's or business's Calendar module (Decision #308): the union of the
 * entity's projects' calendars on the `@projective/ui/calendar` engine, inside the console canvas.
 *
 * The page is read server-side by the `[module]` route (`resolveEntityCalendar`), as the viewer, so
 * every meeting, stage due date and ticket deadline on it is one RLS let them see on its own project.
 * It is the project calendar's body (`ProjectCalendar`) without the composer: an entry belongs to one
 * project, so new ones are added on that project's calendar and this grid creates nothing. An existing
 * event opens the {@link EventModal} as on its project, and its RSVP and reschedule writes are addressed
 * to that project (`entityEventTarget`), where the server re-resolves it.
 *
 * It sits in the console's scrolling canvas rather than filling a region, so it takes the bounded
 * `cal-surface--schedule` height the public schedule page uses.
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

export default function EntityCalendarScreen(props: EntityCalendarScreenProps): JSX.Element {
	const view = entityCalendarView(props);
	const events = useSignal<CalendarEvent[]>(props.initial?.events ?? []);
	const access = useSignal<EventAccess>(
		resolveEventAccess({
			viewerIsClient: props.initial?.viewerIsClient ?? props.kind === "business",
		}, null),
	);

	useEffect(() => {
		const apply = () => {
			access.value = resolveEventAccess(
				{ viewerIsClient: props.initial?.viewerIsClient ?? props.kind === "business" },
				readDevSeam(),
			);
		};
		apply();
		return subscribeDevSeam(apply);
	}, []);

	// Discard the chain when the module goes, so a later visit never inherits a stale frame.
	useEffect(() => () => eventStack.close(), []);

	const page = props.initial;
	const open = eventStack.top.value;
	const framed = open ? events.value.find((e) => e.id === open.id) ?? null : null;
	const target = framed ? entityEventTarget(framed) : null;

	return (
		<div class="wsp" data-kind={props.kind}>
			<div class="wsp__stack">
				<section
					class="wsp-band wsp-band--plain wsp-band--tail"
					aria-label={`${props.name}'s calendar`}
				>
					<div class="wsp-band__inner">
						{page
							? (
								<div class="cal-surface cal-surface--schedule">
									{events.value.length === 0
										? <p class="wsp-pagehead__note" role="status">{view.emptyNote}</p>
										: null}
									<Calendar
										events={events.value}
										timezone={page.timezone}
										view="week"
										focus={page.now}
										title={page.title}
										canCreate={false}
										renderSource={renderCalendarSource}
										storageKey="pj.calendar.entity"
										onOpenEvent={(ev) => {
											const event = ev as CalendarEvent;
											if (entityEventTarget(event)) {
												eventStack.open("event", event.id, {
													mode: "view",
												});
											} else if (event.href) globalThis.location.assign(event.href);
										}}
									/>
								</div>
							)
							: (
								<p class="wsp-pagehead__note" role="alert">
									{props.initialError ?? view.failedNote}
								</p>
							)}
					</div>
				</section>
			</div>
			{page && open && framed && target
				? (
					<EventModal
						key={open.uid}
						uid={open.uid}
						mode={(open.input?.mode ?? "view") as EventMode}
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
							events.value = events.value.map((
								e,
							) => (e.id === ev.id ? { ...ev, projectId: e.projectId } : e));
						}}
						onBook={() => {}}
						onServerUpdate={(ev) => {
							events.value = events.value.map((e) =>
								e.id === ev.id ? { ...ev, projectId: e.projectId, meta: e.meta } : e
							);
						}}
					/>
				)
				: null}
		</div>
	);
}
