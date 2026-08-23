/**
 * @projective/ui/calendar — the left-panel mini-month mini-map (§Part 1.1). Hovering a day subtly
 * highlights the ENTIRE week it belongs to (a soft ~15% tint); clicking a day jumps the primary
 * calendar to it. The currently-focused day/week is marked so the mini-map reflects the main view.
 */
import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import type { CalendarViewMode } from "../core/types.ts";
import {
	fmtMonthYear,
	monthMatrix,
	sameZonedDay,
	sameZonedMonth,
	startOfWeek,
	weekdayLabels,
	zonedDayNum,
} from "../core/time.ts";
import { ChevronLeftIcon, ChevronRightIcon } from "./glyphs.tsx";

export interface MiniMonthProps {
	/** The month the mini-map currently displays (epoch ms within it). */
	monthMs: number;
	/** The main calendar's focus instant (drives the selected-day/week highlight). */
	focusMs: number;
	tz: string;
	view: CalendarViewMode;
	/**
	 * Day-granular "today" (that day's midnight epoch), or null before mount. Deliberately NOT the live
	 * clock: this grid is 42 buttons and only cares which day is today, so it subscribes to a value that
	 * changes at midnight rather than one that changes every minute.
	 */
	todayMs: number | null;
	onPick: (dayStart: number) => void;
	onMonthStep: (delta: number) => void;
}

export function MiniMonth(props: MiniMonthProps): JSX.Element {
	const { tz, view, todayMs } = props;
	const hoverIdx = useSignal<number | null>(null);
	const days = monthMatrix(props.monthMs, tz);
	const focusWeekStart = startOfWeek(props.focusMs, tz);

	return (
		<div class="cal-mini">
			<div class="cal-mini__head">
				<span class="cal-mini__title">{fmtMonthYear(props.monthMs, tz)}</span>
				<div class="cal-mini__nav">
					<button
						type="button"
						class="cal-mini__navbtn"
						onClick={() => props.onMonthStep(-1)}
						aria-label="Previous month"
					>
						<ChevronLeftIcon size={15} />
					</button>
					<button
						type="button"
						class="cal-mini__navbtn"
						onClick={() => props.onMonthStep(1)}
						aria-label="Next month"
					>
						<ChevronRightIcon size={15} />
					</button>
				</div>
			</div>

			<div class="cal-mini__weekdays" aria-hidden="true">
				{weekdayLabels(true).map((w, i) => <span key={i} class="cal-mini__wd">{w}</span>)}
			</div>

			<div class="cal-mini__grid" onPointerLeave={() => (hoverIdx.value = null)}>
				{days.map((d, i) => {
					const row = Math.floor(i / 7);
					const hoveredRow = hoverIdx.value != null && Math.floor(hoverIdx.value / 7) === row;
					const outside = !sameZonedMonth(d, props.monthMs, tz);
					const today = todayMs != null && sameZonedDay(d, todayMs, tz);
					const selectedDay = view === "day" && sameZonedDay(d, props.focusMs, tz);
					const selectedWeek = view === "week" && startOfWeek(d, tz) === focusWeekStart;
					return (
						<button
							key={d}
							type="button"
							class={cx(
								"cal-mini__day",
								hoveredRow && "cal-mini__day--weekhover",
								outside && "cal-mini__day--outside",
								today && "cal-mini__day--today",
								selectedDay && "cal-mini__day--selected",
								selectedWeek && "cal-mini__day--inweek",
							)}
							onPointerEnter={() => (hoverIdx.value = i)}
							onClick={() => props.onPick(d)}
							aria-label={`Jump to ${zonedDayNum(d, tz)}`}
							aria-current={today ? "date" : undefined}
						>
							{zonedDayNum(d, tz)}
						</button>
					);
				})}
			</div>
		</div>
	);
}
