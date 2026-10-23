import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-page.css";
import { Calendar } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import type { CalendarEvent, CalendarEventKind, CalendarPage } from "@projective/types/scheduling";
import { EventModal } from "../components/EventModal.tsx";
import { renderCalendarSource } from "../components/provider-marks.tsx";
import { CalendarConnectAction } from "../components/CalendarConnectAction.tsx";
import { type EventMode, eventStack } from "../core/event-view.ts";
import {
	type EventAccess,
	readDevSeam,
	resolveEventAccess,
	subscribeDevSeam,
} from "../core/event-access.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import { useCalendarComposer } from "../hooks/useCalendarComposer.ts";

/** What a project calendar can create. A booking is taken, not authored, so it is not offered here. */
const CREATE_KINDS: { value: CalendarEventKind; label: string }[] = [
	{ value: "sync", label: "Meeting" },
	{ value: "milestone", label: "Milestone" },
	{ value: "deadline", label: "Deadline" },
	{ value: "session", label: "Session" },
	{ value: "general", label: "Event" },
];

/**
 * ProjectCalendar — the body island for `/projects/[id]/calendar` and `/projects/[id]/[channel]/calendar`.
 *
 * Hydrates from the SSR `initial` {@link CalendarPage} (task deadlines · review milestones · stage
 * syncs · sessions), renders the reusable `@projective/ui/calendar` engine — its own header carries
 * the zoom slider and the timeline toggle — and opens the {@link EventModal} from the grid's
 * selection actions through the shared {@link useCalendarComposer}.
 *
 * Dumb: it fetches only through the thin {@link ScheduleService}, and every fact on the grid — who is
 * seated, what they answered, which negotiation is open — is read from the database as the signed-in
 * reader. The dev seam only moves the persona-level ACCESS labels, which are presentation.
 *
 * Created and edited entries are session-local; the RSVP and reschedule writes are real round trips
 * to the fat service, which owns every rule.
 */
export interface ProjectCalendarProps {
	scope: "project" | "channel";
	projectId: string;
	channelId?: string;
	initial: CalendarPage | null;
}

export default function ProjectCalendar(props: ProjectCalendarProps): JSX.Element {
	const page = useSignal<CalendarPage | null>(props.initial);
	const access = useSignal<EventAccess>(
		resolveEventAccess({ viewerIsClient: props.initial?.viewerIsClient ?? true }, null),
	);
	/** A refetch that failed. Held so the stale page on screen is never passed off as the new one. */
	const loadError = useSignal<string | null>(null);
	const composer = useCalendarComposer({
		initial: props.initial?.events ?? [],
		kind: "sync",
		timezone: () => page.peek()?.timezone ?? "UTC",
	});
	const { events } = composer;

	/**
	 * Pull the page fresh.
	 *
	 * A failure is SURFACED rather than dropped: a stale page left on screen with no word of the failure
	 * reads as the current one.
	 */
	async function load(): Promise<void> {
		const res = await ScheduleService.calendar(props.projectId, props.channelId);
		if (res.ok && res.data) {
			loadError.value = null;
			page.value = res.data.page;
			events.value = res.data.page.events;
		} else {
			loadError.value = res.message ?? "This calendar couldn’t be refreshed.";
		}
	}

	useEffect(() => {
		const apply = () => {
			const seam = readDevSeam();
			access.value = resolveEventAccess(
				{ viewerIsClient: page.value?.viewerIsClient ?? true },
				seam,
			);
		};
		apply();
		return subscribeDevSeam(apply);
	}, []);

	// A page the server could not paint (a failed read, not a missing project) gets one retry on mount.
	useEffect(() => {
		if (!props.initial) void load();
	}, []);

	// Discard the chain when the page goes, so a later visit never inherits a stale frame.
	useEffect(() => () => eventStack.close(), []);

	const p = page.value;
	if (!p) {
		return (
			<div class="cal-surface cal-surface--empty">
				<p class="cal-surface__empty">
					{loadError.value ?? "This calendar couldn’t be loaded."}
				</p>
			</div>
		);
	}

	// Reading the computed here subscribes this component to it, so the modal follows the stack with
	// no listener of its own. The entry is resolved BY ID rather than held by reference, so a write
	// that refreshes the list re-renders the open modal instead of leaving it showing the old event.
	const open = eventStack.top.value;
	const framed = composer.resolve(open);

	return (
		<div class="cal-surface">
			{loadError.value
				? (
					<Message severity="warning" size="sm" class="cal-surface__notice">
						{loadError.value} What you are looking at is the last version that loaded.
					</Message>
				)
				: null}
			<Calendar
				events={events.value}
				timezone={p.timezone}
				view="week"
				focus={p.now}
				title={p.title}
				canCreate={p.canCreate}
				renderSource={renderCalendarSource}
				headerActions={
					<CalendarConnectAction
						returnTo={props.channelId
							? `/projects/${props.projectId}/${props.channelId}/calendar`
							: `/projects/${props.projectId}/calendar`}
					/>
				}
				storageKey="pj.calendar.project"
				compose={composer.compose}
				/*
				 * A drag — on the time grid, or across Month cells — leaves a DRAFT and the lightweight
				 * composer beside it; the full surface is one deliberate press away. `onSelectRange` is
				 * deliberately inert: a stray click on empty grid opening a six-tab dialog was the
				 * behaviour this flow replaces.
				 */
				onSelectRange={() => {}}
				onQuickCreate={composer.quickCreate}
				onExpandCreate={composer.expandCreate}
				onMoveEvent={(ev, range) => composer.moveEvent(ev as CalendarEvent, range)}
				onOpenEvent={(ev) => composer.openEvent(ev as CalendarEvent)}
			/>
			{open && framed
				? (
					<EventModal
						key={open.uid}
						uid={open.uid}
						mode={(open.input?.mode ?? "view") as EventMode}
						event={framed}
						tz={p.timezone}
						hour12
						nowMs={p.now}
						access={access.value}
						target={{
							scope: p.channelId ? "channel" : "project",
							projectId: p.projectId,
							channelId: p.channelId,
						}}
						createKinds={CREATE_KINDS}
						canBook={false}
						onClose={composer.close}
						onMinimise={composer.minimise}
						onSubmit={composer.submit}
						onBook={() => {}}
						onServerUpdate={composer.serverUpdate}
					/>
				)
				: null}
		</div>
	);
}
