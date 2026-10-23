/**
 * @projective/ui/calendar — the left-panel mini-month mini-map (§Part 1.1). Each week is one row, and
 * the row itself carries the week band: a single continuous pill under all seven days, lit on the
 * ACTIVE week at rest (the week the main view shows in Week view, else the week containing today)
 * and on whichever row the pointer is over. Today is the one solid mark; the main view's focus day
 * in Day view is a strong tint, so the two never read alike. Clicking a day jumps the primary
 * calendar to it.
 *
 * The hover band is CSS `:hover` on the row, not a signal: crossing a day no longer re-renders 42
 * buttons, and the band clears on its own over the row gap and when the pointer leaves.
 */
import type { JSX } from "preact";
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
	const days = monthMatrix(props.monthMs, tz);
	const weeks = Array.from({ length: days.length / 7 }, (_, r) => days.slice(r * 7, r * 7 + 7));
	const anchorMs = view === "week" ? props.focusMs : todayMs;
	const activeWeekStart = anchorMs == null ? null : startOfWeek(anchorMs, tz);

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

			<div class="cal-mini__grid">
				{weeks.map((week) => (
					<div
						key={week[0]}
						class={cx(
							"cal-mini__week",
							startOfWeek(week[0], tz) === activeWeekStart && "cal-mini__week--active",
						)}
					>
						{week.map((d) => {
							const outside = !sameZonedMonth(d, props.monthMs, tz);
							const today = todayMs != null && sameZonedDay(d, todayMs, tz);
							const selectedDay = view === "day" && sameZonedDay(d, props.focusMs, tz);
							return (
								<button
									key={d}
									type="button"
									class={cx(
										"cal-mini__day",
										outside && "cal-mini__day--outside",
										selectedDay && "cal-mini__day--selected",
										today && "cal-mini__day--today",
									)}
									onClick={() => props.onPick(d)}
									aria-label={`Jump to ${zonedDayNum(d, tz)}`}
									aria-current={today ? "date" : undefined}
								>
									{zonedDayNum(d, tz)}
								</button>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}
