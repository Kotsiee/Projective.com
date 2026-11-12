import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-page.css";
import { Calendar, type CalendarViewMode } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import type { CalendarEvent, CalendarPage } from "@projective/types/scheduling";
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
import { type CalendarAddress, dateFocus } from "../core/calendar-address.ts";
import { authoringFor } from "../core/calendar-authoring.ts";
import { useCalendarComposer } from "../hooks/useCalendarComposer.ts";
import {
	useCalendarAddressWriter,
	useCalendarWindowReader,
	useOwnedTimelineScale,
} from "../hooks/useCalendarAddress.ts";

/** What an engagement's calendar authors: nothing, until a door keeps it (C7 (a)). */
const AUTHORING = authoringFor("project");

/** The engine's own key for this calendar's densities, and the Timeline scale held here. */
const STORAGE_KEY = "pj.calendar.project";

/**
 * ProjectCalendar — the body island for `/projects/[id]/calendar` and `/projects/[id]/[channel]/calendar`.
 *
 * Hydrates from the SSR `initial` {@link CalendarPage} (task deadlines · review milestones · stage
 * syncs · sessions), renders the reusable `@projective/ui/calendar` engine — its own header carries
 * the zoom slider and the timeline toggle — and opens the {@link EventModal} on an entry through the
 * shared {@link useCalendarComposer}.
 *
 * Dumb: it fetches only through the thin {@link ScheduleService}, and every fact on the grid — who is
 * seated, what they answered, which negotiation is open — is read from the database as the signed-in
 * reader. The dev seam only moves the persona-level ACCESS labels, which are presentation.
 *
 * It authors nothing ({@link AUTHORING}): no door keeps an entry on an engagement's calendar, whose
 * meetings are arranged by the stage and moved through their negotiation, so there is no composer,
 * no drag-move and no edit (Decision #343, ruling C7 (a)). RSVP and the reschedule negotiation are
 * real round trips to the fat service, which owns every rule. The view is addressed as
 * `?view=&date=&zoom=` (Decision #413), and the grid reads the next window as the reader moves (S-29).
 */
export interface ProjectCalendarProps {
	scope: "project" | "channel";
	projectId: string;
	channelId?: string;
	initial: CalendarPage | null;
	/** What the URL asked to be shown; the engine's defaults answer the rest. */
	address?: CalendarAddress;
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

	const address = props.address ?? {};
	/** Where the engine opened: the addressed day, else the page's own clock. Never moved after. */
	const opening = useSignal<number>(
		address.date && props.initial
			? dateFocus(address.date, props.initial.timezone)
			: props.initial?.now ?? Date.now(),
	);
	/** What the engine reports it is showing, for the address and the next window read. */
	const view = useSignal<CalendarViewMode>(address.view ?? "week");
	const focus = useSignal<number>(opening.peek());
	const timelineScale = useOwnedTimelineScale(STORAGE_KEY, address.zoom);

	/**
	 * Read the page around `around`. A failure is SURFACED rather than dropped: a stale page left on
	 * screen with no word of the failure reads as the current one.
	 */
	async function read(around?: string | null): Promise<CalendarPage | null> {
		const res = await ScheduleService.calendar(
			props.projectId,
			props.channelId,
			around ?? address.date,
		);
		if (res.ok && res.data) {
			loadError.value = null;
			return res.data.page;
		}
		loadError.value = res.message ?? "This calendar couldn’t be refreshed.";
		return null;
	}

	function publish(next: CalendarPage): void {
		page.value = next;
		events.value = next.events;
	}

	async function load(): Promise<void> {
		const next = await read();
		if (next) publish(next);
	}

	useCalendarAddressWriter({
		surface: "project",
		state: () => ({ view: view.value, focus: focus.value, timelineScale: timelineScale.value }),
		tz: () => page.peek()?.timezone ?? null,
	});

	useCalendarWindowReader<CalendarPage>({
		window: () => page.value?.window,
		view: () => view.value,
		focus: () => focus.value,
		tz: () => page.value?.timezone ?? null,
		read,
		apply: publish,
	});

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
				view={address.view ?? "week"}
				focus={opening.value}
				timelineZoom={timelineScale}
				loaded={p.window ? { start: p.window.from, end: p.window.to } : null}
				title={p.title}
				canCreate={p.canCreate && AUTHORING.has("create")}
				renderSource={renderCalendarSource}
				headerActions={
					<CalendarConnectAction
						returnTo={props.channelId
							? `/projects/${props.projectId}/${props.channelId}/calendar`
							: `/projects/${props.projectId}/calendar`}
					/>
				}
				storageKey={STORAGE_KEY}
				onViewChange={(v) => (view.value = v)}
				onFocusChange={(ms) => (focus.value = ms)}
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
						createKinds={[]}
						canBook={false}
						editable={AUTHORING.has("edit")}
						onClose={composer.close}
						onSubmit={composer.submit}
						onBook={() => {}}
						onServerUpdate={composer.serverUpdate}
					/>
				)
				: null}
		</div>
	);
}
