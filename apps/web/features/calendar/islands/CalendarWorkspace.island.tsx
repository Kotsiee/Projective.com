import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/calendar-page.css";
import "../styles/calendar-chrome.css";
import { Calendar } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import type { CalendarEvent, CalendarEventKind, SchedulePage } from "@projective/types/scheduling";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import { AvailabilityModal } from "../components/AvailabilityModal.tsx";
import { presetsSaved } from "@features/catalogue/core/availability-store.ts";
import { EventModal } from "../components/EventModal.tsx";
import { renderCalendarSource } from "../components/provider-marks.tsx";
import { type EventMode, eventStack } from "../core/event-view.ts";
import { deepLinkedEvent, EVENT_PARAM, withoutEventParam } from "../core/event-deep-link.ts";
import {
	type DevSeamState,
	type EventAccess,
	readDevSeam,
	resolveEventAccess,
	subscribeDevSeam,
} from "../core/event-access.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import { frameProbe } from "../core/frame-cost.ts";
import { useCalendarComposer } from "../hooks/useCalendarComposer.ts";
import {
	calendarFocus,
	calendarPage,
	calendarPreset,
	calendarView,
	calendarZoom,
	createRequest,
	focusedAt,
	gridSpotlight,
	importedEvents,
	persistCalendarView,
	persistCalendarZoom,
	removeRequest,
	restoreCalendarView,
	selectedEventId,
	selectEvent,
	sourceIsVisible,
	timelineZoom,
	visibleEvents,
} from "../core/calendar-state.ts";

/** What the personal agenda can create. */
/** How long a refused create stays on screen before it clears itself. */
const NOTICE_MS = 5_000;

/** A new entry opens on the next half hour, never at a ragged minute. */
const SLOT_MS = 30 * 60_000;

const CREATE_KINDS: { value: CalendarEventKind; label: string }[] = [
	{ value: "sync", label: "Meeting" },
	{ value: "session", label: "Session" },
	{ value: "deadline", label: "Deadline" },
	{ value: "general", label: "Reminder" },
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
 */
export interface CalendarWorkspaceProps {
	initial: SchedulePage | null;
}

export default function CalendarWorkspace(props: CalendarWorkspaceProps): JSX.Element {
	const page = useSignal<SchedulePage | null>(props.initial);
	/** The developer persona override, tracked so a flip moves the surface without a reload. */
	const seam = useSignal<DevSeamState | null>(null);
	const loadError = useSignal<string | null>(null);
	/** A refused create, in the refusal's own words. */
	const notice = useSignal<string | null>(null);
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	/**
	 * The surface's clock: the page's own `now`, advanced at wall rate since it was read — the same
	 * frame the event modal reasons in (`useEventClock`), so the composer and the modal's Create can
	 * never disagree about whether a slot is in the past.
	 */
	const clockOrigin = useRef({ page: props.initial?.now ?? 0, wall: Date.now() });
	const clock = () =>
		(clockOrigin.current.page || clockOrigin.current.wall) +
		(Date.now() - clockOrigin.current.wall);

	const composer = useCalendarComposer({
		initial: props.initial?.events ?? [],
		kind: "sync",
		timezone: () => page.peek()?.timezone ?? "UTC",
		now: clock,
		onRefuse: (message) => {
			notice.value = message;
			if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
			noticeTimer.current = setTimeout(() => (notice.value = null), NOTICE_MS);
		},
		onClose: () => {
			const loc = globalThis.location;
			if (loc && new URLSearchParams(loc.search).has(EVENT_PARAM)) {
				history.replaceState(history.state, "", withoutEventParam(loc.pathname, loc.search));
			}
		},
	});
	const { events } = composer;

	/** Publish for the lane, the panel and the bands. One reader, one refetch, one answer. */
	function publish(next: SchedulePage): void {
		clockOrigin.current = { page: next.now, wall: Date.now() };
		page.value = next;
		events.value = next.events;
		calendarPage.value = next;
	}

	/*
	 * The session's own writes travel too. An entry created, moved or deleted here changes `events`,
	 * not the fetched page, and the lane's list and the right panel read the page — so without this a
	 * new entry was on the grid and nowhere in the list beside it, and a list pick could not find it.
	 */
	useSignalEffect(() => {
		const list = events.value;
		const current = page.peek();
		if (current) calendarPage.value = { ...current, events: list };
	});

	/** A band asked for a delete (the right panel's Delete). */
	useSignalEffect(() => {
		const id = removeRequest.value;
		if (!id) return;
		removeRequest.value = null;
		remove(id);
	});

	function remove(id: string): void {
		composer.remove(id);
		importedEvents.value = importedEvents.peek().filter((e) => e.id !== id);
		if (selectedEventId.peek() === id) selectedEventId.value = null;
	}

	/**
	 * A failure is SURFACED rather than dropped: a stale agenda left on screen with no word of the
	 * failure reads as the current one.
	 */
	async function load(): Promise<void> {
		const res = await ScheduleService.personal();
		if (res.ok && res.data) {
			loadError.value = null;
			publish(res.data.page);
		} else {
			loadError.value = res.message ?? "This calendar couldn’t be refreshed.";
		}
	}

	useEffect(() => {
		if (props.initial) calendarPage.value = props.initial;
		// The view and zoom are the APP's to remember here (the control lives in the footer band, so
		// the engine is driven rather than deciding) — restored after mount, never at module scope,
		// because this module is also imported during SSR where storage does not exist.
		restoreCalendarView();
		const apply = () => {
			seam.value = readDevSeam();
		};
		apply();
		// An agenda the server could not paint gets one retry on mount.
		if (!props.initial) void load();
		// `?event=<id>` opens that occurrence, on its week, when it is on the agenda.
		const linked = deepLinkedEvent(globalThis.location?.search ?? "", events.peek());
		if (linked) {
			calendarFocus.value = linked.start;
			eventStack.open("event", linked.id, { mode: "view" });
		}
		return subscribeDevSeam(apply);
	}, []);

	// A saved availability template re-mirrors the weekly hours the grid shades and the lane lists.
	useSignalEffect(() => {
		if (presetsSaved.value > 0) void load();
	});

	// The page is a module signal shared with four other trees, so it has to be released when this
	// one goes: leaving the previous surface's agenda in it would let a later mount of the lane paint
	// a week the grid is not showing.
	useEffect(() => () => {
		calendarPage.value = null;
		selectedEventId.value = null;
		eventStack.close();
		if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
	}, []);

	/**
	 * Remember the reader's view choice.
	 *
	 * The first run is skipped: it fires with the default the signal was constructed with, which
	 * would be written over the value {@link restoreCalendarView} is in the middle of installing.
	 */
	const viewSettled = useSignal(false);
	useEffect(() => {
		if (!viewSettled.value) {
			viewSettled.value = true;
			return;
		}
		persistCalendarView(calendarView.value);
	}, [calendarView.value]);

	const zoomSettled = useSignal(false);
	useSignalEffect(() => {
		calendarZoom.value;
		timelineZoom.value;
		if (!zoomSettled.peek()) {
			zoomSettled.value = true;
			return;
		}
		persistCalendarZoom();
	});

	/** A band asked for a blank entry (the footer's New event, or the lane rail's). */
	useEffect(() => {
		if (createRequest.value === 0) return;
		// On the reader's focus, but never behind the clock: a blank entry in the past is one that
		// could only be refused.
		const start = Math.max(focusedAt(page.value), Math.ceil(clock() / SLOT_MS) * SLOT_MS);
		composer.expandCreate({ start, end: start + 3_600_000 }, "");
	}, [createRequest.value]);

	const p = page.value;
	if (!p) {
		return (
			<div class="cal-surface cal-surface--full cal-surface--empty">
				<p class="cal-surface__empty">{loadError.value ?? "Your calendar couldn’t be loaded."}</p>
			</div>
		);
	}

	/*
	 * Imported `.ics` entries sit alongside the fetched ones rather than being merged into them: they
	 * are client-side only until the write path lands, and folding them into `events` would let the
	 * next refetch silently drop entries the reader watched arrive.
	 */
	const all = [...events.value, ...importedEvents.value];
	const shown = visibleEvents(all);

	const open = eventStack.top.value;
	const framed = composer.resolve(open, importedEvents.value);

	/*
	 * A withdrawn calendar leaves no trace: an entry another calendar still holds up survives, but it
	 * stops wearing the mark of the layer the reader just switched off. Built fresh each render — the
	 * body re-renders whenever `hiddenSources` moves, because `visibleEvents` above reads it — so the
	 * grid redraws its stacks with the new answer rather than holding a stale closure.
	 */
	const renderSource = (source: string) =>
		sourceIsVisible(source) ? renderCalendarSource(source) : null;
	const access = accessFor(framed, seam.value);

	return (
		<div class="cal-surface cal-surface--full">
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
				// The entry opens beside the grid (panel or modal), so the engine's popover would repeat it.
				directOpen
				timezone={p.timezone}
				view={calendarView.value}
				zoom={calendarZoom}
				timelineZoom={timelineZoom}
				focus={focusedAt(p)}
				hideSidePanel
				hideHeader
				canCreate
				renderSource={renderSource}
				storageKey={LocalKeys.CALENDAR_DENSITY}
				onViewChange={(v) => (calendarView.value = v)}
				onFocusChange={(ms) => (calendarFocus.value = ms)}
				compose={composer.compose}
				/*
				 * `onSelectRange` no longer opens the full modal, and that is the whole shape of the
				 * flow: a drag on the grid — or a click or a drag across Month cells — leaves a DRAFT
				 * and a lightweight composer beside it, and the full surface is one deliberate press
				 * away (`onExpandCreate`).
				 */
				onSelectRange={() => {}}
				onQuickCreate={composer.quickCreate}
				onExpandCreate={composer.expandCreate}
				onMoveEvent={(ev, range) => composer.moveEvent(ev as CalendarEvent, range)}
				onOpenEvent={(ev) => selectEvent(ev as CalendarEvent, "grid")}
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
						onDelete={(ev) => remove(ev.id)}
					/>
				)
				: null}

			{/* One mount for the lane's and the header band's availability controls. */}
			<AvailabilityModal />
		</div>
	);
}
