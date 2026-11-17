import { type Signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { CalendarComposeRequest, CalendarRange } from "@projective/ui/calendar";
import {
	type CalendarEvent,
	type CalendarEventKind,
	type EntryFields,
	type EntryReminder,
	type EntryRoom,
	swatchOf,
} from "@projective/types/scheduling";
import { blankEvent, eventStack } from "../core/event-view.ts";
import { eventsForRange, firstOccurrence, seriesKey, spreadDaily } from "../core/event-series.ts";
import { seriesOf } from "../core/event-recurrence.ts";
import { roomOf } from "../core/meeting-link.ts";
import { type EntryOrganisation, organisedPatch } from "../core/routine-view.ts";
import { ScheduleService } from "../core/ScheduleService.ts";
import { type DebouncedWrites, debouncedWrites } from "../core/debounced-writes.ts";
import type { CalendarResult } from "../types/results.ts";

/**
 * The fields of an entry its host's write carries — what `scheduling.events` stores. Its routine and
 * behaviour always travel, because `null` is how a routine is left, and the door writes nothing for
 * a row that already says so. A rule travels only on a series' master, and is read on a create only.
 */
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
		availabilityBehavior: e.availabilityBehavior ?? "disruptive",
		routineId: e.routineId ?? null,
		accent: swatchOf(e.accent) === "default" ? null : e.accent,
		recurrenceRule: e.recurrenceRule,
	};
}

/**
 * A colour write: the fields the door requires as the entry stands, and its accent. Its routine,
 * behaviour and rule are left out, which the door reads as "leave them as they are", so a colour can
 * never undo an organise still in flight.
 */
function accentFieldsOf(e: CalendarEvent): EntryFields {
	const { availabilityBehavior: _b, routineId: _r, recurrenceRule: _rule, ...rest } = fieldsOf(e);
	return rest;
}

/** How long a colour, a behaviour or a routine must stay put before it is saved (Decision #441). */
const SETTLE_MS = 500;

/** One series' organise, as it waits: the entry it was asked on and every change merged since. */
interface OrganiseWrite {
	eventId: string;
	change: EntryOrganisation;
}

/** Options for {@link useCalendarComposer}. */
export interface CalendarComposerOptions {
	/** The events the page arrived with. */
	initial: readonly CalendarEvent[];
	/** What a blank entry is minted as. */
	kind: CalendarEventKind;
	/** The display timezone, read when a range becomes entries. */
	timezone: () => string;
	/** Told the server's own words when a persisted write is refused. */
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
	/**
	 * `CalendarProps.onExpandCreate` — a daily range opens on its first day and keeps the series. `kind`
	 * mints something other than the composer's own kind (a Reminder from the lane).
	 */
	expandCreate(range: CalendarRange, title: string, kind?: CalendarEventKind): void;
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
	/**
	 * Move an entry and its whole series into or out of a routine, or set whether they hold time: drawn
	 * at once, saved once the series has stayed put for a moment, and put back with the server's reason.
	 */
	organise(event: CalendarEvent, change: EntryOrganisation): void;
	/** Draw an entry in another colour at once, and save the last of a quick run of picks. */
	recolour(event: CalendarEvent, accent: string | null): void;
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
		write: () => Promise<CalendarResult<{ event: CalendarEvent; series?: CalendarEvent[] }>>,
	): void {
		const before = events.peek().find((e) => e.id === next.id);
		if (!before) return;
		events.value = events.value.map((e) => (e.id === next.id ? next : e));
		if (!optsRef.current.persist) return;
		void write().then((res) => {
			const kept = res.ok && res.data ? res.data.event : before;
			const series = new Map((res.data?.series ?? []).map((e) => [e.id, e]));
			events.value = events.peek().map((e) => (e.id === next.id ? kept : series.get(e.id) ?? e));
			if (!res.ok) refuse(res.message);
		});
	}

	function change(next: CalendarEvent, room?: EntryRoom | null): void {
		apply(next, () => ScheduleService.update(next.id, fieldsOf(next), room));
	}

	// #region Settled writes
	/** Each entry's accent before a run of picks began, for a refused save to go back to. */
	const accentBefore = useRef(new Map<string, string | undefined>());
	/** Each series' rows before a run of organising began. */
	const organiseBefore = useRef(new Map<string, CalendarEvent[]>());
	const writers = useRef<
		{ accent: DebouncedWrites<string | null>; organise: DebouncedWrites<OrganiseWrite> } | null
	>(null);
	if (!writers.current) {
		writers.current = {
			accent: debouncedWrites<string | null>({
				ms: SETTLE_MS,
				merge: (_waiting, next) => next,
				send: saveAccent,
			}),
			organise: debouncedWrites<OrganiseWrite>({
				ms: SETTLE_MS,
				merge: (waiting, next) => ({
					eventId: next.eventId,
					change: { ...waiting.change, ...next.change },
				}),
				send: saveOrganise,
			}),
		};
	}
	const accentWrites = writers.current.accent;
	const organiseWrites = writers.current.organise;

	/** A server row, keeping the colour of one whose own pick is still waiting to be saved. */
	function adopt(server: CalendarEvent, local: CalendarEvent): CalendarEvent {
		return writers.current?.accent.pending(local.id) ? { ...server, accent: local.accent } : server;
	}

	function saveAccent(id: string, accent: string | null): void {
		const current = events.peek().find((e) => e.id === id);
		if (!current) {
			accentBefore.current.delete(id);
			return;
		}
		const fields = accentFieldsOf({ ...current, accent: accent ?? undefined });
		void ScheduleService.update(id, fields).then((res) => {
			const waiting = writers.current?.accent.pending(id) ?? false;
			if (res.ok && res.data) {
				const saved = res.data.event.accent;
				if (waiting) {
					accentBefore.current.set(id, saved);
					return;
				}
				accentBefore.current.delete(id);
				events.value = events.peek().map((e) => (e.id === id ? { ...e, accent: saved } : e));
				return;
			}
			if (!waiting) {
				const before = accentBefore.current.get(id);
				accentBefore.current.delete(id);
				events.value = events.peek().map((e) => (e.id === id ? { ...e, accent: before } : e));
			}
			refuse(res.message);
		});
	}

	function saveOrganise(key: string, write: OrganiseWrite): void {
		void ScheduleService.organise({ eventId: write.eventId, ...write.change }).then((res) => {
			const waiting = writers.current?.organise.pending(key) ?? false;
			const held = organiseBefore.current.get(key) ?? [];
			if (res.ok && res.data) {
				const rows = new Map(res.data.events.map((e) => [e.id, e]));
				if (waiting) {
					organiseBefore.current.set(key, held.map((e) => rows.get(e.id) ?? e));
					return;
				}
				organiseBefore.current.delete(key);
				events.value = events.peek().map((e) => {
					const row = rows.get(e.id);
					return row ? adopt(row, e) : e;
				});
				return;
			}
			if (!waiting) {
				organiseBefore.current.delete(key);
				// Only what this write moved goes back, so a colour picked meanwhile stands.
				const back = new Map(held.map((e) => [e.id, e]));
				events.value = events.peek().map((e) => {
					const was = back.get(e.id);
					return was
						? {
							...e,
							routineId: was.routineId,
							availabilityBehavior: was.availabilityBehavior,
						}
						: e;
				});
			}
			refuse(res.message);
		});
	}

	// A write still settling is sent as the surface goes, rather than lost with it.
	useEffect(() => {
		const flush = () => {
			writers.current?.accent.flush();
			writers.current?.organise.flush();
		};
		globalThis.addEventListener("pagehide", flush);
		return () => {
			globalThis.removeEventListener("pagehide", flush);
			flush();
		};
	}, []);
	// #endregion

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
			create(eventsForRange(range, title, optsRef.current.timezone(), mint));
		},
		expandCreate(range, title, kind) {
			const daily = range.daily ? range : null;
			const at = daily ? firstOccurrence(range, optsRef.current.timezone()) : range;
			const blank = { ...(kind ? blankEvent(at, kind) : mint(at)), title };
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
		organise(event, change) {
			const key = seriesKey(event);
			const before = events.peek();
			if (!organiseBefore.current.has(key)) {
				organiseBefore.current.set(key, before.filter((e) => seriesKey(e) === key));
			}
			events.value = before.map((e) =>
				seriesKey(e) === key ? { ...e, ...organisedPatch(change) } : e
			);
			organiseWrites.schedule(key, { eventId: event.id, change });
		},
		recolour(event, accent) {
			const current = events.peek().find((e) => e.id === event.id);
			if (!current) return;
			events.value = events.peek().map((e) =>
				e.id === event.id ? { ...e, accent: accent ?? undefined } : e
			);
			if (!optsRef.current.persist) return;
			if (!accentBefore.current.has(event.id)) accentBefore.current.set(event.id, current.accent);
			accentWrites.schedule(event.id, accent);
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
