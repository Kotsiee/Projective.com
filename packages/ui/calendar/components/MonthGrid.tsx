/**
 * @projective/ui/calendar — the Month view. A 6×7 matrix of day cells with a weekday header, event
 * chips (up to a cap, then a "+N more" affordance), today + outside-month + blackout states, and
 * click-to-create on an empty cell (an all-day range for that day). Non-interactive cell separation is
 * a single hairline grid, never a four-sided box (§B.4); the interactive event chips carry the accent.
 */
import type { JSX } from "preact";
import { cx } from "../../core/cx.ts";
import type { CalendarAvailability, CalendarEvent, CalendarRange } from "../core/types.ts";
import {
	DAY,
	monthMatrix,
	sameZonedDay,
	sameZonedMonth,
	weekdayLabels,
	zonedDayNum,
} from "../core/time.ts";
import { EventBlock } from "./EventBlock.tsx";

const MAX_CHIPS = 3;

export interface MonthGridProps {
	focusMs: number;
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	nowMs: number;
	mounted: boolean;
	canCreate?: boolean;
	onSelectRange?: (range: CalendarRange) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
	/** Open a specific day (e.g. switch to Day view) when its number is clicked. */
	onOpenDay?: (dayStart: number) => void;
}

export function MonthGrid(props: MonthGridProps): JSX.Element {
	const { tz, hour12, nowMs, mounted } = props;
	const days = monthMatrix(props.focusMs, tz);

	function isBlackout(dayStart: number): boolean {
		if (!props.availability) return false;
		const end = dayStart + DAY;
		return props.availability.blackouts.some((b) => b.start < end && b.end > dayStart);
	}

	return (
		<div class="cal-month">
			<div class="cal-month__weekdays">
				{weekdayLabels().map((w) => <div key={w} class="cal-month__weekday">{w}</div>)}
			</div>
			<div class="cal-month__grid">
				{days.map((d) => {
					const dayEvents = props.events
						.filter((e) => e.start < d + DAY && e.end > d)
						.sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start - b.start);
					const outside = !sameZonedMonth(d, props.focusMs, tz);
					const today = mounted && sameZonedDay(d, nowMs, tz);
					const shown = dayEvents.slice(0, MAX_CHIPS);
					const overflow = dayEvents.length - shown.length;
					return (
						<div
							key={d}
							class={cx(
								"cal-month__cell",
								outside && "cal-month__cell--outside",
								today && "cal-month__cell--today",
								isBlackout(d) && "cal-month__cell--blackout",
							)}
							onPointerDown={props.canCreate
								? (e) => {
									if ((e.target as HTMLElement).closest(".cal-event")) return;
									props.onSelectRange?.({ start: d, end: d + DAY, allDay: true });
								}
								: undefined}
						>
							<div class="cal-month__cellhead">
								<button
									type="button"
									class="cal-month__daynum"
									onClick={() => props.onOpenDay?.(d)}
									aria-label={`Open ${zonedDayNum(d, tz)}`}
								>
									{zonedDayNum(d, tz)}
								</button>
							</div>
							<div class="cal-month__events" role="list">
								{shown.map((e) => (
									<EventBlock
										key={e.id}
										event={e}
										tz={tz}
										hour12={hour12}
										compact
										onOpen={props.onOpenEvent}
									/>
								))}
								{overflow > 0
									? (
										<button
											type="button"
											class="cal-month__more"
											onClick={() => props.onOpenDay?.(d)}
										>
											+{overflow} more
										</button>
									)
									: null}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
