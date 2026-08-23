import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { DateTimePicker } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import { calendarTime } from "@projective/ui/calendar";
import type { CalendarEvent } from "@projective/types/scheduling";
import { eventLiveStatus } from "@projective/types/scheduling";
import { durationLabel, eventBadge } from "../core/event-view.ts";

/**
 * EventMetaBar — the facts that govern an occurrence, read at a glance, and the two that can be moved.
 *
 * The ticket modal's equivalent row carries the four values a client SETS (intensity, priority, due,
 * owner). An event has almost none of those: its governing facts are how long it runs, where it
 * happens and who is running it — statements rather than controls — so the row stays a summary, and
 * the things that are edited at length (the agenda and the room) are edited on the Details tab where
 * there is space to see what you are changing.
 *
 * **WHEN is the exception, and it belongs here.** An occurrence's start and end are the two facts a
 * host most often needs to move, they are one line of text each, and they are the values the badge
 * beside them is a reading of. Sending the host to another tab to change the number they are already
 * looking at is the reason they were static in the first place.
 *
 * The organiser sits alone at the far end for the same reason "Claimed by" does on a ticket: it is
 * the one value on the row nobody reading it chose.
 */
export interface EventMetaBarProps {
	event: CalendarEvent;
	/** IANA display zone — every instant here is rendered in the schedule's own zone. */
	tz: string;
	hour12: boolean;
	/**
	 * The modal's clock, ticking. NOT read from `Date.now()` here, and that is the whole point: this
	 * badge and the gates in the footer are two readings of one instant, so the header can never say
	 * "Passed" above a live RSVP group. The modal owns the clock; this component is handed it.
	 */
	nowMs: number;
	/**
	 * Whether the acting viewer arranges this event.
	 *
	 * The SAME value the modal hands its Details tab — `creating || event.viewerIsHost === true`,
	 * resolved once on the modal from what the SERVER marked. It is not re-derived here, because a
	 * second rule about who may move a session is a second answer waiting to disagree with the first.
	 */
	canEdit: boolean;
	/**
	 * Stage a change onto the modal's working copy.
	 *
	 * Editing here is STAGED exactly like the agenda and the room: the patch lands in the draft held in
	 * the modal-stack frame cache, the footer grows Save the moment it diverges from the baseline, and
	 * nothing reaches the calendar until it is pressed.
	 */
	onPatch: (patch: Partial<CalendarEvent>) => void;
}

// #region Zone bridging
/**
 * The picker reasons in the DEVICE's wall-clock fields; every instant on this surface is rendered in
 * the SCHEDULE's zone. The two are bridged here and nowhere else.
 *
 * An instant is handed to the control as a device-local `Date` whose year/month/day/hour/minute ARE
 * the schedule zone's, and read back through {@link calendarTime.zonedTimeToMs}, which resolves those
 * same fields in `tz` with the DST correction. Without the bridge a host in Lisbon editing a Tokyo
 * schedule would read 09:00 on the bar, open the picker on 01:00, and move the session by eight hours
 * without ever being shown the number they actually changed.
 *
 * Seconds are dropped on purpose: the picker is minute-granular, so carrying a second through a field
 * that cannot express it only lets the value drift back on the next read.
 *
 * One residual case this cannot fix: when the schedule's wall time falls inside the DEVICE zone's own
 * spring-forward gap, the `Date` constructor normalises to the next real local instant and the trigger
 * prints an hour the bar does not. It is reachable for one hour a year, and the honest fix is a
 * zone-aware picker rather than a correction here that would be wrong for the other 8759.
 */
function toPickerDate(ms: number, tz: string): Date {
	const p = calendarTime.zonedParts(ms, tz);
	return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
}

/** The inverse of {@link toPickerDate} — the picker's wall-clock fields, resolved in `tz`. */
function fromPickerDate(d: Date, tz: string): number {
	return calendarTime.zonedTimeToMs(
		d.getFullYear(),
		d.getMonth() + 1,
		d.getDate(),
		d.getHours(),
		d.getMinutes(),
		tz,
	);
}
// #endregion

// #region Bindings
/**
 * A CONTROLLED binding for one instant, in the picker's own coordinate space.
 *
 * The signal is what is handed to the control, never `signal.value`: `useControllable` treats a raw
 * value as UNCONTROLLED and seeds its own signal exactly once, so a plain `Date` prop would show the
 * time the modal opened on and never move again — not on Discard, not on a server-confirmed
 * reschedule, and not when the other picker carries it. (The Reschedule tab records the same trap.)
 *
 * The effect writes only when the underlying instant actually differs, so the write the picker itself
 * just made cannot bounce back through the draft as a second, redundant render. `bound` is omitted
 * from the dependency array because `useSignal` mints it once and its identity never changes.
 */
function useInstantBinding(ms: number, tz: string): Signal<Date | null> {
	const bound = useSignal<Date | null>(toPickerDate(ms, tz));
	useEffect(() => {
		const next = toPickerDate(ms, tz);
		if (bound.peek()?.getTime() !== next.getTime()) bound.value = next;
	}, [ms, tz]);
	return bound;
}
// #endregion

/**
 * The one part of this modal that must stay true as time passes.
 *
 * It advances because the instant it is handed advances — the modal's `useEventClock` ticks and every
 * gate on the surface re-evaluates with it — rather than because this component keeps a second timer
 * of its own. Two clocks on one modal is exactly how the header came to contradict the body.
 */
function EventLiveBadge(props: {
	startMs: number;
	endMs: number;
	whenLabel: string;
	nowMs: number;
}): JSX.Element {
	const badge = eventBadge(
		eventLiveStatus(props.nowMs, props.startMs, props.endMs),
		props.whenLabel,
	);

	return (
		<Tooltip content={badge.title}>
			{
				/*
				 * Deliberately NOT a live region. It changes on its own every half minute, and a status that
				 * announces itself that often buries everything a screen-reader user actually navigated here
				 * for. It stays readable on demand, and its tooltip carries the exact instant the rounded
				 * countdown is an approximation of.
				 */
			}
			<span class="evm__badge" data-tone={badge.tone} tabIndex={0}>
				{badge.label}
			</span>
		</Tooltip>
	);
}

/** One row item: the glyph, what it is, and the value. */
function MetaItem(
	props: { icon: IconName; label: string; children: JSX.Element | string; end?: boolean },
): JSX.Element {
	return (
		<li class="evm-meta__item" data-end={props.end ? "true" : undefined}>
			<Icon name={props.icon} size="2xs" class="evm-meta__mark" />
			<span class="evm-meta__k">{props.label}</span>
			<span class="evm-meta__v">{props.children}</span>
		</li>
	);
}

/**
 * One EDITABLE instant, sitting in the slot its read-only twin would occupy.
 *
 * The row's own word is the control's `<label for>` rather than a hand-written `aria-label`: the word
 * is already printed, and a name that differs from the visible text breaks "label in name"
 * (WCAG 2.5.3). It also makes the label a second, larger target that opens the picker.
 *
 * No button bar. "Clear" would offer to remove a start an occurrence cannot be without, and the
 * handler ignores `null` — a control whose effect is a no-op is worse than an absent one.
 */
function MetaTimeField(props: {
	id: string;
	icon: IconName;
	label: string;
	value: Signal<Date | null>;
	/** Earliest selectable instant. Constrains the day grid AND the tumbler on the boundary day. */
	min?: Date;
	hour12: boolean;
	/** A static fact that belongs beside the control rather than inside it. */
	aside?: string;
	onChange: (next: Date | null) => void;
}): JSX.Element {
	return (
		<li class="evm-meta__item evm-meta__item--edit">
			<Icon name={props.icon} size="2xs" class="evm-meta__mark" />
			<label class="evm-meta__k" for={props.id}>{props.label}</label>
			<span class="evm-meta__field">
				<DateTimePicker
					id={props.id}
					size="sm"
					value={props.value}
					min={props.min}
					hour12={props.hour12}
					// Month-first, matching `calendarTime.fmtFullDate` ("Thursday, July 17, 2026") — the
					// convention the rest of this surface already reads in, so the two orderings cannot
					// disagree about which number is the day.
					dateFormat="mm/dd/yy"
					onValueChange={props.onChange}
				/>
			</span>
			{props.aside ? <span class="evm-meta__aside">{props.aside}</span> : null}
		</li>
	);
}

/**
 * The " · 45 min" that follows an end time, or nothing at all.
 *
 * A deadline has no duration, and a template literal would happily print " · null" rather than
 * saying so — which is the failure mode a nullable label exists to prevent.
 */
function durationSuffix(startMs: number, endMs: number): string {
	const label = durationLabel(startMs, endMs);
	return label ? ` · ${label}` : "";
}

export function EventMetaBar(props: EventMetaBarProps): JSX.Element {
	const { event, tz, hour12, canEdit, onPatch } = props;
	const whenLabel = `${calendarTime.fmtFullDate(event.start, tz)} · ${
		event.allDay ? "all day" : calendarTime.fmtRange(event.start, event.end, tz, hour12)
	}`;

	const startBinding = useInstantBinding(event.start, tz);
	const endBinding = useInstantBinding(event.end, tz);

	/*
	 * An all-day entry keeps the plain text even for its host. A DateTimePicker commits a time of day,
	 * and an all-day occurrence does not have one — offering the control would invite the host to set a
	 * fact the entry cannot carry, and then quietly drop it. A date-only editor for that case is not
	 * built here; it is a separate control, not a flag on this one.
	 */
	const editable = canEdit && !event.allDay;

	/**
	 * Moving the start MOVES THE END WITH IT, keeping the occurrence the same length.
	 *
	 * The alternative — bounding the start with `max={end}` — would enforce the invariant just as
	 * hard and trap the reader: shifting a Monday meeting to Friday would first require lengthening it
	 * to Friday and then trimming it back, and every calendar the host has ever used carries the end
	 * instead. So the start is unbounded, the carry keeps `end >= start` true by construction, and the
	 * duration printed beside the end field is the visible confirmation that nothing else moved.
	 *
	 * Elapsed milliseconds, not wall-clock fields: a 60-minute call is 60 minutes on both sides of a
	 * DST boundary, which is what the reader agreed to.
	 */
	function moveStart(next: Date | null): void {
		if (!next) return;
		const startMs = fromPickerDate(next, tz);
		if (startMs === event.start) return;
		onPatch({ start: startMs, end: startMs + (event.end - event.start) });
	}

	/**
	 * Moving the end changes the length, and can never cross the start.
	 *
	 * That refusal is the picker's `min`, not a check performed afterwards: earlier days are struck out
	 * of the calendar and the tumbler's reels stop at the start's own minute on the boundary day, so
	 * an illegal end is never selectable in the first place. There is deliberately no clamp here — a
	 * `Math.max` that can never fire is untested code reading as though the bound is not trusted.
	 */
	function moveEnd(next: Date | null): void {
		if (!next) return;
		const endMs = fromPickerDate(next, tz);
		if (endMs === event.end) return;
		onPatch({ end: endMs });
	}

	return (
		<ul class="evm-meta" aria-label="Event properties">
			<li class="evm-meta__item evm-meta__item--badge">
				<EventLiveBadge
					startMs={event.start}
					endMs={event.end}
					whenLabel={whenLabel}
					nowMs={props.nowMs}
				/>
			</li>

			{editable
				? (
					<>
						<MetaTimeField
							id={`evm-start-${event.id}`}
							icon="calendar"
							label="Starts"
							value={startBinding}
							hour12={hour12}
							onChange={moveStart}
						/>
						<MetaTimeField
							id={`evm-end-${event.id}`}
							icon="clock"
							label="Ends"
							value={endBinding}
							// The invariant, expressed as the control's own bound. It is re-read from the draft
							// on every render, so a start that has just moved narrows this one immediately.
							min={toPickerDate(event.start, tz)}
							hour12={hour12}
							aside={durationLabel(event.start, event.end) ?? undefined}
							onChange={moveEnd}
						/>
					</>
				)
				: (
					<>
						<MetaItem icon="calendar" label="Starts">
							<time dateTime={new Date(event.start).toISOString()}>
								{calendarTime.fmtFullDate(event.start, tz)}
								{event.allDay ? "" : `, ${calendarTime.fmtTime(event.start, tz, hour12)}`}
							</time>
						</MetaItem>

						<MetaItem icon="clock" label="Ends">
							<time dateTime={new Date(event.end).toISOString()}>
								{event.allDay ? "All day" : calendarTime.fmtTime(event.end, tz, hour12)}
								{event.allDay ? "" : durationSuffix(event.start, event.end)}
							</time>
						</MetaItem>
					</>
				)}

			{event.meeting
				? (
					<MetaItem icon="video-camera" label="Room">
						{event.meeting.providerLabel}
					</MetaItem>
				)
				: event.location
				? <MetaItem icon="pin-location" label="Where">{event.location}</MetaItem>
				: null}

			{event.organiser
				? (
					<li class="evm-meta__item" data-end="true">
						<Icon name="user" size="2xs" class="evm-meta__mark" />
						<span class="evm-meta__k">Organiser</span>
						<span class="evm-person evm-meta__v">
							<Avatar
								image={event.organiser.avatar ?? undefined}
								label={event.organiser.name}
								size={20}
								alt=""
							/>
							<span class="evm-person__name">{event.organiser.name}</span>
						</span>
					</li>
				)
				: null}
		</ul>
	);
}
