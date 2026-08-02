/**
 * @projective/ui/calendar — one day's timed column. Positions events from the overlap-packing
 * geometry (fractional columns so concurrent events sit side-by-side), shades the day's working-hours
 * windows + blackout (availability overlay), draws the live now-line when it is today, and exposes an
 * empty-surface pointer-down for click / drag-to-select. Times clip to [midnight, midnight+24h] so an
 * event never renders in the overscroll pad; a midnight-crossing event continues in the next column.
 */
import type { JSX } from "preact";
import { styleVars } from "../../core/style.ts";
import type { CalendarEvent } from "../core/types.ts";
import { DAY, minutesFromDayStart } from "../core/time.ts";
import { packDayEvents } from "../core/layout.ts";
import { gridGeometry } from "../hooks/useCalendarViewport.ts";
import { EventBlock } from "./EventBlock.tsx";

export interface WorkingWindow {
	startMinute: number;
	endMinute: number;
}

export interface DayColumnProps {
	dayStart: number;
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	pxPerHour: number;
	rangeStartMin: number;
	rangeEndMin: number;
	/** This weekday's working-hours windows (schedule surfaces) — shaded as bookable bands. */
	workingWindows?: WorkingWindow[];
	/** Whole-day blackout / holiday tint. */
	blackout?: boolean;
	isToday?: boolean;
	/** Minutes-from-midnight of the live now, or null (only set on today, after mount). */
	nowMinuteOfDay?: number | null;
	onOpenEvent?: (e: CalendarEvent) => void;
	onCreatePointerDown?: (dayStart: number, e: PointerEvent) => void;
}

export function DayColumn(props: DayColumnProps): JSX.Element {
	const { dayStart, tz, hour12, pxPerHour, rangeStartMin, rangeEndMin } = props;
	const { yFor, hFor } = gridGeometry(pxPerHour, rangeStartMin);

	const dayEnd = dayStart + DAY;
	const dayEvents = props.events.filter((e) => !e.allDay && e.start < dayEnd && e.end > dayStart);
	const slots = packDayEvents(dayEvents);

	return (
		<div class="cal-daycol" role="list" aria-label="Events">
			<div
				class="cal-daycol__hit"
				onPointerDown={props.onCreatePointerDown
					? (e) => props.onCreatePointerDown!(dayStart, e as unknown as PointerEvent)
					: undefined}
			/>

			{props.blackout ? <div class="cal-daycol__blackout" aria-hidden="true" /> : null}

			{(props.workingWindows ?? []).map((w, i) => {
				const top = yFor(Math.max(rangeStartMin, w.startMinute));
				const h = yFor(Math.min(rangeEndMin, w.endMinute)) - top;
				if (h <= 0) return null;
				return (
					<div
						key={`w${i}`}
						class="cal-daycol__avail"
						style={styleVars({ "--cal-top": `${top}px`, "--cal-h": `${h}px` })}
						aria-hidden="true"
					/>
				);
			})}

			{slots.map(({ event, col, cols, span }) => {
				const sMin = Math.max(0, minutesFromDayStart(event.start, dayStart));
				const eMin = Math.min(24 * 60, minutesFromDayStart(event.end, dayStart));
				const top = yFor(sMin);
				const h = Math.max(hFor(Math.max(eMin - sMin, 12)), 14);
				const leftPct = (col / cols) * 100;
				const widthPct = (span / cols) * 100;
				return (
					<div
						key={event.id}
						class="cal-daycol__event"
						style={styleVars({
							"--cal-top": `${top}px`,
							"--cal-h": `${h}px`,
							"--cal-left": `${leftPct}%`,
							"--cal-w": `${widthPct}%`,
						})}
					>
						<EventBlock
							event={event}
							tz={tz}
							hour12={hour12}
							roomy={h >= 40}
							onOpen={props.onOpenEvent}
						/>
					</div>
				);
			})}

			{props.isToday && props.nowMinuteOfDay != null
				? (
					<div
						class="cal-daycol__now"
						style={styleVars({ "--cal-top": `${yFor(props.nowMinuteOfDay)}px` })}
						aria-hidden="true"
					>
						<span class="cal-daycol__now-dot" />
					</div>
				)
				: null}
		</div>
	);
}
