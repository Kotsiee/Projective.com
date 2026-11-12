import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar-page.css";
import "../styles/calendar-chrome.css";
import { Calendar, type CalendarContextTarget, EventPopoverLayer } from "@projective/ui/calendar";
import { ConfirmDialog, Message } from "@projective/ui/feedback";
import { ActionMenu } from "@projective/ui/navigation";
import {
	awaitsAnswer,
	type CalendarEvent,
	type CalendarEventKind,
	DEFAULT_CALENDAR_PREFS,
	type SchedulePage,
	withClashCounts,
} from "@projective/types/scheduling";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import { renderInspectActions } from "../components/EventPopoverActions.tsx";
import { EventModal } from "../components/EventModal.tsx";
import { renderCalendarSource } from "../components/provider-marks.tsx";
import { RoutineDialog } from "../components/RoutineDialog.tsx";
import { type EventMode, eventStack } from "../core/event-view.ts";
import {
	deepLinkedEvent,
	deepLinkedRoutine,
	invitationsFiltered,
} from "../core/event-deep-link.ts";
import {
	type DevSeamState,
	type EventAccess,
	readDevSeam,
	resolveEventAccess,
	subscribeDevSeam,
} from "../core/event-access.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import { frameProbe } from "../core/frame-cost.ts";
import type { CalendarAddress } from "../core/calendar-address.ts";
import { kindOfHidden } from "../core/calendar-address.ts";
import { agendaRows, authoringFor, timesMovable } from "../core/calendar-authoring.ts";
import { useCalendarComposer } from "../hooks/useCalendarComposer.ts";
import { useCalendarViewMemory } from "../hooks/useCalendarViewMemory.ts";
import {
	useCalendarAddress,
	useCalendarAddressWriter,
	useCalendarWindowReader,
} from "../hooks/useCalendarAddress.ts";
import {
	agendaReload,
	calendarFocus,
	calendarInspectMode,
	calendarPage,
	calendarPresent,
	calendarPreset,
	calendarRoutines,
	calendarSnapZoom,
	calendarView,
	calendarZoom,
	createRequest,
	deselectEvent,
	eventReread,
	focusedAt,
	gridSpotlight,
	hiddenClasses,
	hiddenClassesAt,
	inspectInPanel,
	inspectPopover,
	inspectRoutine,
	invitationsOnly,
	leavingEvents,
	openEventModal,
	organiseRequest,
	releaseCalendarAddress,
	remindersRequest,
	removeRequest,
	routineDialogOpen,
	selectedEventId,
	selectedRoutineId,
	selectEvent,
	sourceIsVisible,
	timelineZoom,
	updateRequest,
	viewAt,
	visibleEvents,
} from "../core/calendar-state.ts";

/** How long a refused create stays on screen before it clears itself. */
const NOTICE_MS = 5_000;

/** A new entry opens on the next half hour, never at a ragged minute. */
const SLOT_MS = 30 * 60_000;
/** A new entry is an hour long until the reader says otherwise. */
const HOUR_MS = 3_600_000;

/**
 * What the personal agenda can create: the two things a person thinks in (`entryClassOf`). An Event is
 * stored as a `sync` and a Reminder as a `general` entry with no length, so neither asks anything new
 * of `scheduling.event_kind`.
 */
const CREATE_KINDS: { value: CalendarEventKind; label: string; instant?: boolean }[] = [
	{ value: "sync", label: "Event" },
	{ value: "general", label: "Reminder", instant: true },
];

/**
 * Which side of the market the viewer is on FOR ONE EVENT.
 *
 * `/calendar` is the union of every engagement the account is on, and those engagements do not agree
 * about the viewer: they sell on some and buy on others. A surface-wide constant therefore cannot be
 * right — the shipped one hardcoded the provider seat, so the footer's money read "You earn" on an
 * occurrence borrowed from an engagement where the viewer is the client and the honest word is "You
 * pay". Every other calendar surface has one answer because it IS one engagement; this one does not.
 *
 * `viewerIsHost` is the server's own per-event answer — whether the reader holds the event's host
 * seat, by identity (`live-calendar.ts`) — which is exactly the fact needed and is already on the
 * event. It is absent on an entry the viewer is not a
 * party to and on a draft — and the privacy projection withholds `pricing` from a non-party, so
 * there is no figure to mislabel there; the honest answer is that we have not been told, and neither
 * seat is claimed.
 *
 * The developer seam still overrides the whole surface when it is on: it simulates a PERSONA, which
 * is a fact about the viewer rather than about one occurrence, and the persona → capability mapping
 * stays owned by {@link resolveEventAccess} rather than being re-derived here.
 */
function accessFor(event: CalendarEvent | null, seam: DevSeamState | null): EventAccess {
	if (seam) return resolveEventAccess({ viewerIsClient: event?.viewerIsHost === false }, seam);
	if (event?.viewerIsHost === true) return { isClient: false, isFreelancer: true };
	if (event?.viewerIsHost === false) return { isClient: true, isFreelancer: false };
	return { isClient: false, isFreelancer: false };
}

/** What `/calendar` authors: its host's own entries, through the event door (C7 (a)). */
const AUTHORING = authoringFor("personal");

/**
 * Where a popover points when the view hands over no rect: the card that took the press, which holds
 * focus by now. `null` when focus is elsewhere (a browser that does not focus a pressed button), and
 * the pick then docks in the panel, since a popover pointing at nothing would be worse.
 */
function focusedAnchor(surface: HTMLElement | null) {
	const el = document.activeElement;
	if (!(el instanceof HTMLElement) || !surface?.contains(el)) return null;
	const box = el.getBoundingClientRect();
	return { x: box.left, y: box.top, w: box.width, h: box.height };
}

/**
 * CalendarWorkspace — the BODY of the `/calendar` hub, and nothing but the grid.
 *
 * Every piece of chrome the engine can draw is suppressed here: the mini-month is the middle-nav
 * panel's, the header row is the header band's and the view control the footer band's, so
 * `hideSidePanel` + `hideHeader` leave `.cal__view` alone in the content region. That is the region
 * contract as `/wallet` and `/messages` settled it — the body views and selects data, and owns no
 * navigation, no filter entry and no primary action.
 *
 * It is the ONE reader on the surface. The lane, the panel and both bands render in the frame,
 * outside this tree, and read the page through {@link calendarPage} rather than fetching their own:
 * a lane that fetched separately would draw an upcoming list from a different response than the
 * grid beside it, and the two would disagree the moment a write landed.
 *
 * A right-click on the grid opens the entry's rows (Edit event · Delete event for one the viewer
 * hosts, else Open details) or, on empty time, New event on the slot under the pointer (Decision
 * #380). The menu is an `ActionMenu` surface: portalled, stacked, clamped, keyboard-reachable.
 *
 * A pick opens as its reader set (Decision #388): in the panel, which the grid reaches through
 * `directOpen`, or in a popover, which is the engine's own in the views that paint one and the layer
 * mounted here for a lane row or a Month card. The inspector is another hydration root, so its in-place
 * edits come back here to be written, on the same handshake as its Delete.
 *
 * It authors only what the event door keeps ({@link AUTHORING}): the host's own entries, created from
 * a drag, a click, a touch or the keyboard, and moved or deleted while their time is the host's to
 * move. It owns the address (`?view=&date=&zoom=&kind=`, Decision #413) and the read window (S-29):
 * the body writes the one and reads the next as the reader moves.
 */
export interface CalendarWorkspaceProps {
	initial: SchedulePage | null;
	/** What the URL asked to be shown; the reader's stored defaults answer the rest. */
	address?: CalendarAddress;
}

export default function CalendarWorkspace(props: CalendarWorkspaceProps): JSX.Element {
	useCalendarAddress(props.address, props.initial?.timezone ?? null);
	const page = useSignal<SchedulePage | null>(props.initial);
	/** The developer persona override, tracked so a flip moves the surface without a reload. */
	const seam = useSignal<DevSeamState | null>(null);
	const loadError = useSignal<string | null>(null);
	/** A refused create, in the refusal's own words. */
	const notice = useSignal<string | null>(null);
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** The grid region the right-click menu binds to, and what the grid said was under the pointer. */
	const surfaceRef = useRef<HTMLDivElement>(null);
	const pointed = useSignal<CalendarContextTarget | null>(null);
	/** The entry a menu Delete is waiting on the reader's confirmation for. */
	const doomed = useSignal<CalendarEvent | null>(null);
	const confirmDelete = useSignal(false);

	/**
	 * The surface's clock: the page's own `now`, advanced at wall rate since it was read — the same
	 * frame the event modal reasons in (`useEventClock`), so a blank entry and the modal's past warning
	 * agree about where now is.
	 */
	const clockOrigin = useRef({ page: props.initial?.now ?? 0, wall: Date.now() });
	const clock = () =>
		(clockOrigin.current.page || clockOrigin.current.wall) +
		(Date.now() - clockOrigin.current.wall);

	const composer = useCalendarComposer({
		initial: props.initial?.events ?? [],
		kind: "sync",
		timezone: () => page.peek()?.timezone ?? "UTC",
		// The personal agenda's entries are the viewer's own, and the only ones with a write route.
		persist: true,
		onRefuse: (message) => {
			notice.value = message;
			if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
			noticeTimer.current = setTimeout(() => (notice.value = null), NOTICE_MS);
		},
	});
	const { events } = composer;

	/** Publish for the lane, the panel and the bands. One reader, one refetch, one answer. */
	function publish(next: SchedulePage): void {
		clockOrigin.current = { page: next.now, wall: Date.now() };
		page.value = next;
		events.value = next.events;
		calendarPage.value = next;
		calendarRoutines.value = next.routines ?? [];
	}

	/*
	 * The session's own writes travel too. An entry created, moved or deleted here changes `events`,
	 * not the fetched page, and the lane's list and the right panel read the page — so without this a
	 * new entry was on the grid and nowhere in the list beside it, and a list pick could not find it.
	 */
	useSignalEffect(() => {
		const list = events.value;
		const current = page.peek();
		if (current) calendarPage.value = { ...current, events: withClashCounts(list) };
	});

	/** An entry the right panel re-read: an answer given there, or its guest list changed. */
	useSignalEffect(() => {
		const next = eventReread.value;
		if (!next) return;
		eventReread.value = null;
		composer.serverUpdate(next);
	});

	/** A band asked for a delete (the right panel's Delete). */
	useSignalEffect(() => {
		const id = removeRequest.value;
		if (!id) return;
		removeRequest.value = null;
		remove(id);
	});

	/** An in-place edit from the inspector. */
	useSignalEffect(() => {
		const next = updateRequest.value;
		if (!next) return;
		updateRequest.value = null;
		composer.update(next);
	});

	/** The reader's own alerts, from the inspector. */
	useSignalEffect(() => {
		const asked = remindersRequest.value;
		if (!asked) return;
		remindersRequest.value = null;
		composer.setReminders(asked.event, asked.reminders);
	});

	/** An entry organised from outside this tree: the lane's drop, the inspector's fields. */
	useSignalEffect(() => {
		const asked = organiseRequest.value;
		if (!asked) return;
		organiseRequest.value = null;
		composer.organise(asked.event, asked.change);
	});

	/** A routine moved entries this tree cannot see, so the agenda is read again. */
	useSignalEffect(() => {
		if (agendaReload.value > 0) void load();
	});

	function remove(id: string): void {
		composer.remove(id);
		if (selectedEventId.peek() === id) deselectEvent();
	}

	/** The day the window on screen was read around; `null` is the page's own `now`. */
	const readAround = useRef<string | null>(props.address?.date ?? null);

	/**
	 * Read the agenda around `around`. A failure is SURFACED rather than dropped: a stale agenda left
	 * on screen with no word of the failure reads as the current one.
	 */
	async function read(around: string | null): Promise<SchedulePage | null> {
		const res = await ScheduleService.personal(around);
		if (res.ok && res.data) {
			loadError.value = null;
			readAround.current = around;
			return res.data.page;
		}
		loadError.value = res.message ?? "This calendar couldn’t be refreshed.";
		return null;
	}

	/** Read the window on screen again. */
	async function load(): Promise<void> {
		const next = await read(readAround.current);
		if (next) publish(next);
	}

	// The view and zoom are the APP's to remember here (the control lives in the footer band, so the
	// engine is driven rather than deciding) — restored after mount, never at module scope, because this
	// module is also imported during SSR where storage does not exist. The address outranks them.
	useCalendarViewMemory(props.address);

	useCalendarAddressWriter({
		surface: "personal",
		state: () => ({
			view: calendarView.value,
			focus: focusedAt(page.value, props.address),
			timelineScale: timelineZoom.value,
			kind: kindOfHidden(hiddenClasses.value),
		}),
		tz: () => page.peek()?.timezone ?? null,
	});

	useCalendarWindowReader<SchedulePage>({
		window: () => page.value?.window,
		view: () => calendarView.value,
		focus: () => focusedAt(page.value, props.address),
		tz: () => page.value?.timezone ?? null,
		read,
		apply: publish,
	});

	useEffect(() => {
		invitationsOnly.value = invitationsFiltered(globalThis.location?.search ?? "");
		if (props.initial) {
			calendarPage.value = props.initial;
			calendarRoutines.value = props.initial.routines ?? [];
		}
		const apply = () => {
			seam.value = readDevSeam();
		};
		apply();
		// An agenda the server could not paint gets one retry on mount.
		if (!props.initial) void load();
		// `?event=<id>` opens that occurrence in the inspector, on its week, when it is on the agenda.
		const linked = deepLinkedEvent(globalThis.location?.search ?? "", events.peek());
		if (linked) {
			calendarFocus.value = linked.start;
			inspectInPanel(linked);
		} else {
			const routine = deepLinkedRoutine(
				globalThis.location?.search ?? "",
				props.initial?.routines ?? [],
			);
			if (routine) inspectRoutine(routine);
		}
		return subscribeDevSeam(apply);
	}, []);

	// The page is a module signal shared with four other trees, so it has to be released when this
	// one goes: leaving the previous surface's agenda in it would let a later mount of the lane paint
	// a week the grid is not showing.
	useEffect(() => () => {
		calendarPage.value = null;
		calendarRoutines.value = null;
		selectedEventId.value = null;
		selectedRoutineId.value = null;
		routineDialogOpen.value = false;
		inspectPopover.value = null;
		eventStack.close();
		releaseCalendarAddress();
		if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
	}, []);

	/** The reader's setting, or the Dev Context Switcher's override of it. */
	const inspectMode = (seam.value?.calendarInspect !== "auto" && seam.value?.calendarInspect) ||
		page.value?.prefs?.inspectMode || DEFAULT_CALENDAR_PREFS.inspectMode;
	useEffect(() => {
		calendarInspectMode.value = inspectMode;
	}, [inspectMode]);

	/** A band asked for a blank entry (the footer's New event, or the lane rail's). */
	useEffect(() => {
		if (createRequest.value === 0) return;
		// On the reader's focus, but never behind the clock: a blank entry opens on the next free slot,
		// and one meant for the past is moved there in the modal, which says so.
		const start = Math.max(focusedAt(page.value), Math.ceil(clock() / SLOT_MS) * SLOT_MS);
		composer.expandCreate({ start, end: start + HOUR_MS }, "");
	}, [createRequest.value]);

	const p = page.value;
	if (!p) {
		return (
			<div class="cal-surface cal-surface--full cal-surface--empty">
				<p class="cal-surface__empty">{loadError.value ?? "Your calendar couldn’t be loaded."}</p>
			</div>
		);
	}

	const leaving = leavingEvents.value;
	/*
	 * The engine knows nothing of RSVPs, so the answer waiting on the reader becomes its two words; and
	 * nothing of the door, so an entry whose move the door would refuse is marked `fixed` and its drag
	 * stays a click.
	 */
	const shown = visibleEvents(events.value, invitationsOnly.value, hiddenClassesAt(props.address))
		.map((e) => {
			const ghost = awaitsAnswer(e);
			const gone = leaving.includes(e.id);
			const fixed = !timesMovable(e);
			return ghost || gone || fixed ? { ...e, ghost, leaving: gone, fixed } : e;
		});

	const open = eventStack.top.value;
	const framed = composer.resolve(open);

	/*
	 * A withdrawn calendar leaves no trace: an entry another calendar still holds up survives, but it
	 * stops wearing the mark of the layer the reader just switched off. Built fresh each render — the
	 * body re-renders whenever `hiddenSources` moves, because `visibleEvents` above reads it — so the
	 * grid redraws its stacks with the new answer rather than holding a stale closure.
	 */
	const renderSource = (source: string) =>
		sourceIsVisible(source) ? renderCalendarSource(source) : null;
	const access = accessFor(framed, seam.value);
	const menu = agendaRows(pointed.value, p.timezone, {
		create: (range) =>
			composer.expandCreate(
				range.allDay ? range : { start: range.start, end: range.start + HOUR_MS },
				"",
			),
		createBlank: () => createRequest.value++,
		open: (ev) => selectEvent(ev, "grid"),
		edit: (ev) => openEventModal(ev.id),
		remove: (ev) => {
			doomed.value = ev;
			confirmDelete.value = true;
		},
	}, AUTHORING);

	return (
		<div
			class="cal-surface cal-surface--full"
			ref={surfaceRef}
			// Cleared before the grid reports, so a press the grid can't resolve never reuses a stale one.
			onContextMenuCapture={() => (pointed.value = null)}
		>
			{loadError.value
				? (
					<Message severity="warning" size="sm" class="cal-surface__notice">
						{loadError.value} What you are looking at is the last version that loaded.
					</Message>
				)
				: null}
			{notice.value
				? (
					<Message severity="warning" size="sm" class="cal-surface__notice">
						{notice.value}
					</Message>
				)
				: null}
			<Calendar
				onFrame={frameProbe()}
				events={shown}
				// "Hide availability" withdraws the working-hours shading with the open slots.
				availability={calendarPreset.value === "events" ? undefined : p.availability}
				spotlight={gridSpotlight}
				present={calendarPresent}
				// In the panel the entry opens beside the grid, so the engine's popover would repeat it.
				directOpen={inspectMode === "panel"}
				renderEventActions={renderInspectActions}
				timezone={p.timezone}
				view={viewAt(props.address)}
				zoom={calendarZoom}
				timelineZoom={timelineZoom}
				snapZoom={calendarSnapZoom.value}
				focus={focusedAt(p, props.address)}
				loaded={p.window ? { start: p.window.from, end: p.window.to } : null}
				hideSidePanel
				hideHeader
				canCreate={AUTHORING.has("create")}
				renderSource={renderSource}
				storageKey={LocalKeys.CALENDAR_DENSITY}
				onViewChange={(v) => (calendarView.value = v)}
				onFocusChange={(ms) => (calendarFocus.value = ms)}
				compose={composer.compose}
				/*
				 * A drag on the grid, a click, a touch or the keyboard's create — or a drag across Month
				 * cells — leaves a DRAFT and the lightweight composer beside it, and the full surface is
				 * one deliberate press away (`onExpandCreate`). The engine routes all of them there
				 * itself, so there is no `onSelectRange` to be told.
				 */
				onQuickCreate={composer.quickCreate}
				onExpandCreate={composer.expandCreate}
				onMoveEvent={AUTHORING.has("move")
					? (ev, range) => composer.moveEvent(ev as CalendarEvent, range)
					: undefined}
				// Month is the one view with no popover of its own, and from the others this is the
				// popover's title asking for more, which is the panel.
				onOpenEvent={(ev) =>
					selectEvent(
						ev as CalendarEvent,
						"grid",
						calendarView.peek() === "month" ? focusedAnchor(surfaceRef.current) : null,
					)}
				onContextTarget={(t) => (pointed.value = t)}
			/>
			<EventPopoverLayer
				state={inspectPopover}
				tz={p.timezone}
				hour12
				renderEventActions={renderInspectActions}
				onOpenEvent={(ev) => inspectInPanel(ev as CalendarEvent)}
			/>
			<ActionMenu
				model={menu}
				surface={surfaceRef}
				aria-label={pointed.value?.event ? "Event actions" : "Calendar actions"}
			/>
			<ConfirmDialog
				visible={confirmDelete}
				header="Delete this event?"
				message="Delete this event from your calendar?"
				acceptLabel="Delete"
				rejectLabel="Keep"
				acceptSeverity="danger"
				onAccept={() => {
					const ev = doomed.peek();
					doomed.value = null;
					if (ev) remove(ev.id);
				}}
				onReject={() => (doomed.value = null)}
			/>
			<RoutineDialog tz={p.timezone} now={p.now} />

			{open && framed
				? (
					<EventModal
						key={open.uid}
						uid={open.uid}
						mode={(open.input?.mode ?? "view") as EventMode}
						initialTab={open.input?.tab}
						event={framed}
						tz={p.timezone}
						hour12
						nowMs={p.now}
						access={access}
						target={{ scope: "personal" }}
						createKinds={CREATE_KINDS}
						canBook={false}
						onClose={composer.close}
						onMinimise={composer.minimise}
						onSubmit={composer.submit}
						onBook={() => {
							/*
							 * Unreachable: `canBook` is false on this surface. A personal agenda is the
							 * viewer's own week — there is nothing on it to buy a seat at, and the booking
							 * flow belongs to the schedule it would be bought from.
							 */
						}}
						onServerUpdate={composer.serverUpdate}
						onServerRemove={composer.serverRemove}
						onDelete={(ev) => remove(ev.id)}
						onReminders={composer.setReminders}
					/>
				)
				: null}
		</div>
	);
}
