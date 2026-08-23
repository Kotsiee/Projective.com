import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/calendar-page.css";
import { Calendar } from "@projective/ui/calendar";
import type { CalendarComposeRequest } from "@projective/ui/calendar";
import { Message } from "@projective/ui/feedback";
import type {
	CalendarEvent,
	CalendarEventKind,
	CalendarPage,
	SchedulingSim,
} from "@projective/types/scheduling";
import { EventModal } from "../components/EventModal.tsx";
import { renderCalendarSource } from "../components/provider-marks.tsx";
import { CalendarConnectAction } from "../components/CalendarConnectAction.tsx";
import { blankEvent, type EventMode, eventStack } from "../core/event-view.ts";
import { type EventAccess, readDevSeam, resolveEventAccess } from "../core/event-access.ts";
import { simFromSeam, subscribeSchedulingSim } from "../core/scheduling-seam.ts";
import { ScheduleService } from "../core/ScheduleService.ts";

/** Reference focus instant — matches the fixtures' fixed clock so the calendar opens on the seeded week. */
const FOCUS = Date.parse("2026-07-17T16:20:00Z");

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
 * syncs · sessions), renders the reusable `@projective/ui/calendar` engine, and opens the
 * {@link EventModal} from the grid's selection actions.
 *
 * Dumb: it fetches only through the thin {@link ScheduleService}. It refetches on a dev-seam change
 * because those axes are SERVER-derived (who is seated, what they answered, which negotiation is
 * live) — a re-render alone would show the same data with a different label on it.
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
	const events = useSignal<CalendarEvent[]>(props.initial?.events ?? []);
	/** The entry being composed — it is not on the grid yet, so it cannot be resolved from it. */
	const draft = useSignal<CalendarEvent | null>(null);
	/** The way back into the engine's lightweight composer — see `CalendarProps.compose`. */
	const composeReq = useSignal<CalendarComposeRequest | null>(null);
	const access = useSignal<EventAccess>(
		resolveEventAccess({ viewerIsClient: props.initial?.viewerIsClient ?? true }, null),
	);
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
		const res = await ScheduleService.calendar(props.projectId, props.channelId, next);
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
		// A seam change moves data the server produced, so it is a refetch and not a re-render.
		return subscribeSchedulingSim((next) => {
			sim.value = next;
			apply();
			void load(next);
		});
	}, []);

	useEffect(() => {
		if (props.initial) {
			// SSR paints the un-simulated page; if an override is already active on first mount, pull the
			// simulated one so the developer is not looking at somebody else's seating.
			const first = simFromSeam();
			if (first) {
				sim.value = first;
				void load(first);
			}
			return;
		}
		void load(sim.value);
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
	// no listener of its own.
	const open = eventStack.top.value;
	// Resolved BY ID rather than held by reference, so a write that refreshes the list re-renders the
	// open modal instead of leaving it showing the event as it was when it was opened.
	const framed = open
		? draft.value && draft.value.id === open.id
			? draft.value
			: events.value.find((e) => e.id === open.id) ?? null
		: null;

	function openEvent(ev: CalendarEvent): void {
		draft.value = null;
		eventStack.open("event", ev.id, { mode: "view" });
	}

	function close(): void {
		eventStack.close();
		draft.value = null;
	}

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
				focus={FOCUS}
				title={p.title}
				canCreate={p.canCreate}
				renderSource={renderCalendarSource}
				headerActions={
					/*
					 * What replaced the integration chips.
					 *
					 * The chips were `<span>`s painted from a hardcoded five-provider fixture and wired to
					 * nothing — they could not be pressed and reported a connection state no part of the
					 * product had ever asked the integrations service for. This is one button that opens the
					 * real consent dialog, so the state a reader sees comes from
					 * `integrations.user_connections` and the affordance actually does something.
					 *
					 * The return path is THIS calendar, so a consent started here comes back here rather
					 * than depositing the reader in Settings.
					 */


						<CalendarConnectAction
							returnTo={props.channelId
								? `/projects/${props.projectId}/${props.channelId}/calendar`
								: `/projects/${props.projectId}/calendar`}
						/>

				}
				storageKey="pj.calendar.project"
				compose={composeReq}
				/*
				 * A drag leaves a DRAFT block and the lightweight composer beside it; the full surface is
				 * one deliberate press away. `onSelectRange` is deliberately inert — a stray click on empty
				 * grid opening a six-tab dialog was the behaviour this flow replaces.
				 */
				onSelectRange={() => {}}
				onQuickCreate={(range, title) => {
					const made = { ...blankEvent(range, "sync"), title };
					draft.value = null;
					events.value = [...events.value, made];
				}}
				onExpandCreate={(range, title) => {
					const blank = { ...blankEvent(range, "sync"), title };
					draft.value = blank;
					eventStack.open("event", blank.id, { mode: "create" });
				}}
				onMoveEvent={(ev, range) => {
					const moved = { ...(ev as CalendarEvent), start: range.start, end: range.end };
					events.value = events.value.map((e) => (e.id === moved.id ? moved : e));
				}}
				onOpenEvent={(ev) => openEvent(ev as CalendarEvent)}
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
							scope: p.channelId ? "channel" : "project",
							projectId: p.projectId,
							channelId: p.channelId,
							sim: sim.value,
						}}
						createKinds={CREATE_KINDS}
						canBook={false}
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
						onBook={() => {}}
						onServerUpdate={(ev) => {
							events.value = events.value.map((e) => (e.id === ev.id ? ev : e));
						}}
					/>
				)
				: null}
		</div>
	);
}
