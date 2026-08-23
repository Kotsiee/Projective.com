import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-page.css";
import { Calendar } from "@projective/ui/calendar";
import type { CalendarComposeRequest, CalendarRange } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import type {
	CalendarEvent,
	CalendarEventKind,
	SchedulePage,
	SchedulingSim,
} from "@projective/types/scheduling";
import { EventModal } from "../components/EventModal.tsx";
import { renderCalendarSource } from "../components/provider-marks.tsx";
import { blankEvent, type EventMode, eventStack } from "../core/event-view.ts";
import { type EventAccess, readDevSeam, resolveEventAccess } from "../core/event-access.ts";
import { simFromSeam, subscribeSchedulingSim } from "../core/scheduling-seam.ts";
import { ScheduleService } from "../core/ScheduleService.ts";

/** Reference focus instant — matches the fixtures' fixed clock so the schedule opens on the seeded week. */
const FOCUS = Date.parse("2026-07-17T16:20:00Z");

/** What a schedule surface can create. */
const CREATE_KINDS: { value: CalendarEventKind; label: string }[] = [
	{ value: "session", label: "Session" },
	{ value: "booking", label: "Booking" },
	{ value: "sync", label: "Meeting" },
];

/**
 * ScheduleView — the body island for the schedule surfaces: `/[handle]/availability`,
 * `/view/[entity]/schedule` and its profile-namespace mirror.
 *
 * Hydrates from the SSR `initial` {@link SchedulePage} (weekly working hours + timezone + blackouts +
 * privacy-masked bookable/busy blocks + public group sessions), renders the `@projective/ui/calendar`
 * engine with the availability overlay, and opens the {@link EventModal} from the grid.
 *
 * These are the platform's guest-reachable calendars, so the modal a stranger opens is genuinely
 * thinner than the one a party opens: the service withholds the roster, the room, the money and the
 * negotiation from anyone who is not on the event, and {@link eventTabs} then has nothing to build
 * those tabs from. That is the privacy contract working, not a missing feature.
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
	/** The entry being composed — it is not on the grid yet, so it cannot be resolved from it. */
	const draft = useSignal<CalendarEvent | null>(null);
	/** The way back into the engine's lightweight composer — see `CalendarProps.compose`. */
	const composeReq = useSignal<CalendarComposeRequest | null>(null);
	// A schedule page is somebody else's: the viewer is on the buying side of it unless the dev seam
	// says otherwise, which is exactly what `viewerIsClient: true` means to the access resolver.
	const access = useSignal<EventAccess>(resolveEventAccess({ viewerIsClient: true }, null));
	const sim = useSignal<SchedulingSim | undefined>(undefined);
	/** A refetch that failed. Held so the stale page on screen is never passed off as the new one. */
	const loadError = useSignal<string | null>(null);

	/**
	 * Pull the page fresh under whatever simulation is active.
	 *
	 * A failure is SURFACED rather than dropped. The refetch is what a dev-seam change is — the axes
	 * are server-derived — so discarding a failed one silently left the previous persona's seating on
	 * screen under the new persona's label, which is the one outcome a simulation must never produce.
	 */
	async function load(next: SchedulingSim | undefined): Promise<void> {
		const res = props.scope === "availability" && props.handle
			? await ScheduleService.availability(props.handle, next)
			: props.entityId
			? await ScheduleService.schedule(props.entityId, next)
			: null;
		if (res && res.ok && res.data) {
			loadError.value = null;
			page.value = res.data.page;
			events.value = res.data.page.events;
		} else {
			loadError.value = res?.message ?? "This schedule couldn’t be refreshed.";
		}
	}

	useEffect(() => {
		const apply = () => {
			access.value = resolveEventAccess({ viewerIsClient: true }, readDevSeam());
		};
		apply();
		// A seam change moves data the server produced, so it is a refetch and not a re-render.
		return subscribeSchedulingSim((next) => {
			sim.value = next;
			apply();
			void load(next);
		});
	}, []);

	useEffect(() => {
		if (props.initial) {
			const first = simFromSeam();
			if (first) {
				sim.value = first;
				void load(first);
			}
			return;
		}
		void load(sim.value);
	}, []);

	useEffect(() => () => eventStack.close(), []);

	const surfaceMod = props.fullPage ? "cal-surface--full" : "cal-surface--schedule";
	const p = page.value;
	if (!p) {
		return (
			<div class={`cal-surface ${surfaceMod} cal-surface--empty`}>
				<p class="cal-surface__empty">
					{loadError.value ?? "This schedule couldn’t be loaded."}
				</p>
			</div>
		);
	}

	const open = eventStack.top.value;
	const framed = open
		? draft.value && draft.value.id === open.id
			? draft.value
			: events.value.find((e) => e.id === open.id) ?? null
		: null;

	function close(): void {
		eventStack.close();
		draft.value = null;
	}

	return (
		<div class={`cal-surface ${surfaceMod}`}>
			{loadError.value
				? (
					<Message severity="warning" size="sm" class="cal-surface__notice">
						{loadError.value} What you are looking at is the last version that loaded.
					</Message>
				)
				: null}
			<Calendar
				events={events.value}
				availability={p.availability}
				timezone={p.timezone}
				view="week"
				focus={FOCUS}
				title={p.subtitle ?? p.title}
				canCreate={p.viewerCanBook}
				renderSource={renderCalendarSource}
				storageKey="pj.calendar.schedule"
				compose={composeReq}
				/*
				 * A drag leaves a DRAFT block and the lightweight composer beside it; the full surface is
				 * one deliberate press away. There is deliberately no `onQuickCreate` HERE, unlike the
				 * personal and project calendars: on a schedule the thing being created is a SESSION
				 * somebody is booking, and "Enter creates it with defaults" would skip every question a
				 * booking has to answer. The composer offers the expand control and nothing else.
				 */
				onSelectRange={() => {}}
				onExpandCreate={(range: CalendarRange, title: string) => {
					if (!p.viewerCanBook) return;
					const blank = { ...blankEvent(range, "session"), title };
					draft.value = blank;
					eventStack.open("event", blank.id, { mode: "create" });
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
						nowMs={FOCUS}
						access={access.value}
						target={{
							scope: props.scope,
							handle: props.handle,
							entityId: props.entityId,
							sim: sim.value,
						}}
						createKinds={CREATE_KINDS}
						canBook={p.viewerCanBook}
						onClose={close}
						onMinimise={(ev) => {
							composeReq.value = { range: { start: ev.start, end: ev.end }, title: ev.title };
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
						onBook={(ev) => {
							/*
							 * A booked slot is a NEW entry over the same span; the open block it came from is
							 * deliberately left in place, because consuming it is the server's job and the
							 * surface must not claim a seat the backend has not taken. Session-local until the
							 * gate lands.
							 */
							events.value = [...events.value, {
								...ev,
								id: `booking-${ev.id}-${ev.start}`,
								title: "You're booked",
								kind: "booking",
								status: "confirmed",
								masked: false,
							}];
							close();
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
