import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { CalendarComposeRequest, CalendarRange } from "@projective/ui/calendar";
import type {
	CalendarEvent,
	CalendarEventKind,
	EntryFields,
	EntryReminder,
	EntryRoom,
} from "@projective/types/scheduling";
import { createRefusal } from "@projective/types/scheduling";
import { blankEvent, eventStack } from "../core/event-view.ts";
import { eventsForRange, firstOccurrence, spreadDaily } from "../core/event-series.ts";
import { seriesOf } from "../core/event-recurrence.ts";
import { roomOf } from "../core/meeting-link.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import type { CalendarResult } from "../types/results.ts";

/** The fields of an entry its host's write carries — what `scheduling.events` stores. */
function fieldsOf(e: CalendarEvent): EntryFields {
	return {
		title: e.title,
		kind: e.kind,
		start: e.start,
		end: e.end,
		allDay: e.allDay,
		location: e.location,
		description: e.description,
		externalSync: e.externalSync,
	};
}

/** Options for {@link useCalendarComposer}. */
export interface CalendarComposerOptions {
	/** The events the page arrived with. */
	initial: readonly CalendarEvent[];
	/** What a blank entry is minted as. */
	kind: CalendarEventKind;
	/** The display timezone, read when a range becomes entries. */
	timezone: () => string;
	/**
	 * The surface's clock. Present, every create path refuses a range that starts before it
	 * ({@link createRefusal}); absent, nothing is gated.
	 */
	now?: () => number;
	/** Told the refusal's own words when a create is refused, or a persisted write is. */
	onRefuse?: (message: string) => void;
	/**
	 * The entries are the viewer's own and every create, edit, move and delete is written through
	 * {@link ScheduleService} (`/calendar`): applied at once, then swapped for the server's copy or
	 * taken back with the server's reason. Absent, every write stays session-local.
	 */
	persist?: boolean;
}

/** One calendar body's entries, draft, composer round trip and modal handlers. */
export interface CalendarComposer {
	/** The session's entries — the page's, plus everything created or moved here. */
	events: Signal<CalendarEvent[]>;
	/** The entry being composed in the full modal; it is not on the grid yet. */
	draft: Signal<CalendarEvent | null>;
	/** The way back into the engine's composer from a minimised modal (`CalendarProps.compose`). */
	compose: Signal<CalendarComposeRequest | null>;
	/** The entry the modal stack's top frame names: the draft, an entry, or one of `extra`. */
	resolve(top: { id: string } | null, extra?: readonly CalendarEvent[]): CalendarEvent | null;
	/** `CalendarProps.onQuickCreate` — a daily range commits one entry per day. */
	quickCreate(range: CalendarRange, title: string): void;
	/** `CalendarProps.onExpandCreate` — a daily range opens on its first day and keeps the series. */
	expandCreate(range: CalendarRange, title: string): void;
	moveEvent(event: CalendarEvent, range: CalendarRange): void;
	openEvent(event: CalendarEvent): void;
	close(): void;
	/** `EventModal.onMinimise` — fold the modal back into the composer, series and all. */
	minimise(event: CalendarEvent): void;
	/**
	 * `EventModal.onSubmit` — a new daily entry is laid onto every day of its series, a repeating one
	 * onto the occurrences of its rule (`seriesOf`).
	 */
	submit(event: CalendarEvent): void;
	/** Save an entry as it stands, leaving its room alone: an in-place edit from the inspector. */
	update(event: CalendarEvent): void;
	/** Save the viewer's own alerts for an entry, any seat's. `null` follows their default. */
	setReminders(event: CalendarEvent, reminders: EntryReminder[] | null): void;
	serverUpdate(event: CalendarEvent): void;
	/** A server write took this entry off the calendar: drop it here, writing nothing. */
	serverRemove(id: string): void;
	/** Take an entry off the calendar, closing it if it is the one open. */
	remove(id: string): void;
}

/**
 * The create, move and open flow every calendar body shares — `/calendar`, a project's and a
 * channel's calendar, and the schedule pages — so a composer commit, a multi-day or daily range from
 * the Month view, a minimise round trip and a submit mean the same thing on each of them.
 *
 * Writes persist where `persist` says so (`/calendar`, Decision #328 (a)) and are session-local
 * elsewhere; RSVP and reschedule round trips reach the server through `serverUpdate`.
 */
export function useCalendarComposer(opts: CalendarComposerOptions): CalendarComposer {
	const events = useSignal<CalendarEvent[]>([...opts.initial]);
	const draft = useSignal<CalendarEvent | null>(null);
	const compose = useSignal<CalendarComposeRequest | null>(null);
	const series = useRef<CalendarRange | null>(null);
	const optsRef = useRef(opts);
	optsRef.current = opts;

	const mint = (range: CalendarRange) => blankEvent(range, optsRef.current.kind);

	/** The create guard: `true` when the range may be created, else the refusal is reported. */
	function creatable(range: { start: number; end: number; allDay?: boolean }): boolean {
		const { now, onRefuse } = optsRef.current;
		const refusal = now ? createRefusal(now(), range) : null;
		if (refusal) onRefuse?.(refusal);
		return !refusal;
	}

	function close(): void {
		eventStack.close();
		draft.value = null;
		series.current = null;
	}

	function refuse(message: string | undefined): void {
		optsRef.current.onRefuse?.(message ?? "That change could not be saved.");
	}

	/** Lay new entries on, then swap them for the server's copies — or take them back off. */
	function create(
		made: CalendarEvent[],
		room?: EntryRoom | null,
		reminders?: EntryReminder[] | null,
	): void {
		events.value = [...events.value, ...made];
		if (!optsRef.current.persist) return;
		const pending = new Set(made.map((e) => e.id));
		void ScheduleService.create(made.map(fieldsOf), room, reminders).then((res) => {
			const rest = events.peek().filter((e) => !pending.has(e.id));
			events.value = res.ok && res.data ? [...rest, ...res.data.events] : rest;
			if (!res.ok) refuse(res.message);
		});
	}

	/**
	 * Replace one entry, then keep the server's copy — or put the previous one back.
	 * shortcut: an edit to an entry whose create is still in flight (a `draft-` id) is refused and
	 * rolled back; queue it behind the create if that ever shows up in practice.
	 */
	function apply(
		next: CalendarEvent,
		write: () => Promise<CalendarResult<{ event: CalendarEvent }>>,
	): void {
		const before = events.peek().find((e) => e.id === next.id);
		if (!before) return;
		events.value = events.value.map((e) => (e.id === next.id ? next : e));
		if (!optsRef.current.persist) return;
		void write().then((res) => {
			const kept = res.ok && res.data ? res.data.event : before;
			events.value = events.peek().map((e) => (e.id === next.id ? kept : e));
			if (!res.ok) refuse(res.message);
		});
	}

	function change(next: CalendarEvent, room?: EntryRoom | null): void {
		apply(next, () => ScheduleService.update(next.id, fieldsOf(next), room));
	}

	return {
		events,
		draft,
		compose,
		resolve(top, extra = []) {
			if (!top) return null;
			const d = draft.value;
			if (d && d.id === top.id) return d;
			return events.value.find((e) => e.id === top.id) ??
				extra.find((e) => e.id === top.id) ?? null;
		},
		quickCreate(range, title) {
			draft.value = null;
			if (!creatable(range)) return;
			create(eventsForRange(range, title, optsRef.current.timezone(), mint));
		},
		expandCreate(range, title) {
			const daily = range.daily ? range : null;
			const at = daily ? firstOccurrence(range, optsRef.current.timezone()) : range;
			if (!creatable(at)) return;
			const blank = { ...mint(at), title };
			series.current = daily;
			draft.value = blank;
			eventStack.open("event", blank.id, { mode: "create" });
		},
		moveEvent(event, range) {
			change({ ...event, start: range.start, end: range.end });
		},
		openEvent(event) {
			draft.value = null;
			series.current = null;
			eventStack.open("event", event.id, { mode: "view" });
		},
		close,
		minimise(event) {
			const range = series.current ??
				{ start: event.start, end: event.end, allDay: event.allDay };
			compose.value = { range, title: event.title };
			close();
		},
		submit(event) {
			const room = roomOf(event);
			if (events.value.some((e) => e.id === event.id)) {
				change(event, room);
				draft.value = null;
				return;
			}
			if (!creatable(event)) return;
			const tz = optsRef.current.timezone();
			create(
				event.recurrenceRule
					? seriesOf(event, tz).events
					: series.current
					? spreadDaily(event, series.current, tz)
					: [event],
				room,
				event.reminders,
			);
			close();
		},
		update(event) {
			change(event);
		},
		setReminders(event, reminders) {
			apply({ ...event, reminders }, () => ScheduleService.setReminders(event.id, reminders));
		},
		serverUpdate(event) {
			events.value = events.value.map((e) => (e.id === event.id ? event : e));
		},
		serverRemove(id) {
			if (eventStack.top.peek()?.id === id) close();
			events.value = events.value.filter((e) => e.id !== id);
		},
		remove(id) {
			if (eventStack.top.peek()?.id === id) close();
			const gone = events.peek().find((e) => e.id === id);
			if (!gone) return;
			events.value = events.value.filter((e) => e.id !== id);
			if (!optsRef.current.persist) return;
			void ScheduleService.remove(id).then((res) => {
				if (res.ok) return;
				events.value = [...events.peek(), gone];
				refuse(res.message);
			});
		},
	};
}
