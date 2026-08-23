import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-page.css";
import "../styles/calendar-chrome.css";
import { Calendar } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import type { CalendarComposeRequest, CalendarRange } from "@projective/ui/calendar";
import type {
	CalendarEvent,
	CalendarEventKind,
	SchedulePage,
	SchedulingSim,
} from "@projective/types/scheduling";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import { EventModal } from "../components/EventModal.tsx";
import { renderCalendarSource } from "../components/provider-marks.tsx";
import { blankEvent, type EventMode, eventStack } from "../core/event-view.ts";
import {
	type DevSeamState,
	type EventAccess,
	readDevSeam,
	resolveEventAccess,
} from "../core/event-access.ts";
import { simFromSeam, subscribeSchedulingSim } from "../core/scheduling-seam.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import { frameProbe } from "../core/frame-cost.ts";
import {
	CALENDAR_REFERENCE,
	calendarFocus,
	calendarPage,
	calendarView,
	createRequest,
	importedEvents,
	persistCalendarView,
	restoreCalendarView,
	sourceIsVisible,
	visibleEvents,
} from "../core/calendar-state.ts";

/** What the personal agenda can create. */
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
 * `viewerIsHost` is the server's own per-event answer, derived from the owning engagement's
 * `viewerIsClient` and then refined by identity (`withCoordination` → `resolveSeat`), which is
 * exactly the fact needed and is already on the event. It is absent on an entry the viewer is not a
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
 * Every piece of chrome the engine can draw is suppressed here: the side panel is the middle-nav
 * lane's job and the header row is the header band's, so `hideSidePanel` + `hideHeader` leave
 * `.cal__view` alone in the content region. That is the region contract as `/wallet` and `/messages`
 * settled it — the body views and selects data, and owns no navigation, no filter entry and no
 * primary action.
 *
 * It is the ONE reader on the surface. The lane and both bands render in the frame, outside this
 * tree, and read the page through {@link calendarPage} rather than fetching their own: a lane that
 * fetched separately would draw an upcoming list from a different response than the grid beside it,
 * and the two would disagree the moment a write landed.
 */
export interface CalendarWorkspaceProps {
	initial: SchedulePage | null;
}

export default function CalendarWorkspace(props: CalendarWorkspaceProps): JSX.Element {
	const page = useSignal<SchedulePage | null>(props.initial);
	const events = useSignal<CalendarEvent[]>(props.initial?.events ?? []);
	/** The entry being composed — it is not on the grid yet, so it cannot be resolved from it. */
	const draft = useSignal<CalendarEvent | null>(null);
	/**
	 * The way BACK into the calendar's lightweight composer, for a full modal being minimised.
	 *
	 * A one-shot request the engine consumes and clears. It exists because the composer's popover is
	 * the engine's own state and this island is its sibling, not its parent — so "re-open it, here,
	 * with this title" has to travel as a message rather than as a prop the host keeps holding.
	 */
	const compose = useSignal<CalendarComposeRequest | null>(null);
	/** The developer persona override, tracked so a flip moves the surface without a reload. */
	const seam = useSignal<DevSeamState | null>(null);
	const sim = useSignal<SchedulingSim | undefined>(undefined);
	const loadError = useSignal<string | null>(null);

	/** Publish for the lane and the bands. One reader, one refetch, one answer. */
	function publish(next: SchedulePage): void {
		page.value = next;
		events.value = next.events;
		calendarPage.value = next;
	}

	/**
	 * A failure is SURFACED rather than dropped. The refetch is what a dev-seam change is — the axes
	 * are server-derived — so discarding a failed one silently left the previous persona's seating on
	 * screen under the new persona's label, which is the one outcome a simulation must never produce.
	 */
	async function load(next: SchedulingSim | undefined): Promise<void> {
		const res = await ScheduleService.personal(next);
		if (res.ok && res.data) {
			loadError.value = null;
			publish(res.data.page);
		} else {
			loadError.value = res.message ?? "This calendar couldn’t be refreshed.";
		}
	}

	useEffect(() => {
		if (props.initial) calendarPage.value = props.initial;
		// The view is the APP's to remember here (the switch lives in the lane footer and the header
		// band, so the engine is driven rather than deciding) — restored after mount, never at module
		// scope, because this module is also imported during SSR where storage does not exist.
		restoreCalendarView();
		const apply = () => {
			seam.value = readDevSeam();
		};
		apply();
		const first = simFromSeam();
		if (first) {
			sim.value = first;
			void load(first);
		} else if (!props.initial) void load(undefined);
		// A seam change moves data the SERVER produced, so it is a refetch and not a re-render.
		return subscribeSchedulingSim((next) => {
			sim.value = next;
			apply();
			void load(next);
		});
	}, []);

	// The page is a module signal shared with three other trees, so it has to be released when this
	// one goes: leaving the previous surface's agenda in it would let a later mount of the lane paint
	// a week the grid is not showing.
	useEffect(() => () => {
		calendarPage.value = null;
		eventStack.close();
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

	/** A band asked for a blank entry (the lane footer's ＋ New event, or the rig's). */
	useEffect(() => {
		if (createRequest.value === 0) return;
		const start = calendarFocus.value;
		const blank = blankEvent({ start, end: start + 3_600_000 }, "sync");
		draft.value = blank;
		eventStack.open("event", blank.id, { mode: "create" });
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
	const framed = open
		? draft.value && draft.value.id === open.id
			? draft.value
			: all.find((e) => e.id === open.id) ?? null
		: null;

	function close(): void {
		eventStack.close();
		draft.value = null;
	}

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
			<Calendar
				onFrame={frameProbe()}
				events={shown}
				availability={p.availability}
				timezone={p.timezone}
				view={calendarView.value}
				focus={calendarFocus.value}
				hideSidePanel
				hideHeader
				canCreate
				renderSource={renderSource}
				storageKey={LocalKeys.CALENDAR_DENSITY}
				onViewChange={(v) => (calendarView.value = v)}
				onFocusChange={(ms) => (calendarFocus.value = ms)}
				compose={compose}
				/*
				 * `onSelectRange` no longer opens the full modal, and that is the whole shape of the new
				 * flow: a drag on the grid leaves a DRAFT block and a lightweight composer beside it, and
				 * the full surface is one deliberate press away (`onExpandCreate`). Jumping straight to a
				 * modal made every stray click on empty grid a six-tab dialog.
				 */
				onSelectRange={() => {}}
				onQuickCreate={(range: CalendarRange, title: string) => {
					// Enter in the composer: the event is created with the defaults every other field
					// already has. `blankEvent` is the SAME factory the full modal mints from, so the two
					// paths cannot disagree about what a new entry starts as.
					const made = { ...blankEvent(range, "sync"), title };
					draft.value = null;
					events.value = [...events.value, made];
				}}
				onExpandCreate={(range: CalendarRange, title: string) => {
					const blank = { ...blankEvent(range, "sync"), title };
					draft.value = blank;
					eventStack.open("event", blank.id, { mode: "create" });
				}}
				onMoveEvent={(ev, range) => {
					// Optimistic and per-session, like every sibling calendar mutation — the scheduling
					// write path is still deferred. Supplying the handler is what ENABLES the drag at all.
					const moved = { ...(ev as CalendarEvent), start: range.start, end: range.end };
					events.value = events.value.map((e) => (e.id === moved.id ? moved : e));
				}}
				onOpenEvent={(ev) => {
					draft.value = null;
					eventStack.open("event", (ev as CalendarEvent).id, { mode: "view" });
				}}
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
						nowMs={CALENDAR_REFERENCE}
						access={access}
						target={{ scope: "personal", sim: sim.value }}
						createKinds={CREATE_KINDS}
						canBook={false}
						onClose={close}
						onMinimise={(ev) => {
							// The full surface folds back into the composer carrying its STAGED contents, and
							// the draft block returns to the grid where the reader left it. `close()` clears
							// the modal's own draft, so the composer's copy is the only one left.
							compose.value = { range: { start: ev.start, end: ev.end }, title: ev.title };
							close();
						}}
						onSubmit={(ev) => {
							const existing = events.value.some((e) => e.id === ev.id);
							events.value = existing
								? events.value.map((e) => (e.id === ev.id ? ev : e))
								: [...events.value, ev];
							draft.value = null;
							if (!existing) close();
						}}
						onBook={() => {
							/*
							 * Unreachable: `canBook` is false on this surface. A personal agenda is the
							 * viewer's own week — there is nothing on it to buy a seat at, and the booking
							 * flow belongs to the schedule it would be bought from.
							 */
						}}
						onServerUpdate={(ev) => {
							events.value = events.value.map((e) => (e.id === ev.id ? ev : e));
						}}
					/>
				)
				: null}
		</div>
	);
}
