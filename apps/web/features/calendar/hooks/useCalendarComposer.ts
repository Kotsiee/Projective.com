import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { CalendarComposeRequest, CalendarRange } from "@projective/ui/calendar";
import type { CalendarEvent, CalendarEventKind } from "@projective/types/scheduling";
import { createRefusal } from "@projective/types/scheduling";
import { blankEvent, eventStack } from "../core/event-view.ts";
import { eventsForRange, firstOccurrence, spreadDaily } from "../core/event-series.ts";

/** Options for {@link useCalendarComposer}. */
export interface CalendarComposerOptions {
	/** The events the page arrived with. */
	initial: readonly CalendarEvent[];
	/** What a blank entry is minted as. */
	kind: CalendarEventKind;
	/** The display timezone, read when a range becomes entries. */
	timezone: () => string;
	/** Runs after the modal stack closes (e.g. to strip a deep-link parameter). */
	onClose?: () => void;
	/**
	 * The surface's clock. Present, every create path refuses a range that starts before it
	 * ({@link createRefusal}); absent, nothing is gated.
	 */
	now?: () => number;
	/** Told the refusal's own words when a create is refused. */
	onRefuse?: (message: string) => void;
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
	/** `EventModal.onSubmit` — a new daily entry is laid onto every day of its series. */
	submit(event: CalendarEvent): void;
	serverUpdate(event: CalendarEvent): void;
	/** Take an entry off the calendar, closing it if it is the one open. */
	remove(id: string): void;
}

/**
 * The create, move and open flow every calendar body shares — `/calendar`, a project's and a
 * channel's calendar, and the schedule pages — so a composer commit, a multi-day or daily range from
 * the Month view, a minimise round trip and a submit mean the same thing on each of them.
 *
 * Writes are session-local, as every calendar mutation is until the scheduling write path lands;
 * RSVP and reschedule round trips reach the server through `serverUpdate`.
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
		optsRef.current.onClose?.();
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
			const made = eventsForRange(range, title, optsRef.current.timezone(), mint);
			events.value = [...events.value, ...made];
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
			const moved = { ...event, start: range.start, end: range.end };
			events.value = events.value.map((e) => (e.id === moved.id ? moved : e));
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
			if (events.value.some((e) => e.id === event.id)) {
				events.value = events.value.map((e) => (e.id === event.id ? event : e));
				draft.value = null;
				return;
			}
			if (!creatable(event)) return;
			const made = series.current
				? spreadDaily(event, series.current, optsRef.current.timezone())
				: [event];
			events.value = [...events.value, ...made];
			close();
		},
		serverUpdate(event) {
			events.value = events.value.map((e) => (e.id === event.id ? event : e));
		},
		remove(id) {
			if (eventStack.top.peek()?.id === id) close();
			events.value = events.value.filter((e) => e.id !== id);
		},
	};
}
