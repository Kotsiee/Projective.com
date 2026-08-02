/**
 * @projective/ui/calendar — the Day view's INFINITE, virtualized continuous timeline (§Part 1.2). Unlike
 * the Week grid (7 bounded time-of-day columns), the Day view is one continuous vertical column of
 * stacked days: scrolling down flows seamlessly past midnight into the next day, up into the previous —
 * endlessly (a ±WINDOW_DAYS elapsed-time axis, effectively unbounded, so the scroll never hits a wall).
 * Only the days intersecting the viewport (plus an overscan) are rendered, so DOM cost stays fixed at any
 * scroll depth. Everything is positioned by ELAPSED minutes from a fixed reference midnight, and each
 * day's boundaries/labels come from zoned day arithmetic (`addZonedDays`), so it is DST-correct. The
 * centred day is reported back (`onFocusDayChange`) so the header label + mini-map track the scroll.
 */
import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { CalendarAvailability, CalendarEvent, CalendarRange } from "../core/types.ts";
import {
	addZonedDays,
	DAY,
	fmtDayLabel,
	fmtHourLabel,
	MIN,
	sameZonedDay,
	startOfDay,
	zonedWeekday,
} from "../core/time.ts";
import { packDayEvents } from "../core/layout.ts";
import { useCalendarViewport } from "../hooks/useCalendarViewport.ts";
import { EventBlock } from "./EventBlock.tsx";
import { TodayIcon } from "./glyphs.tsx";

/** Half-window (days) each side of the mount-day — a ~4-year continuous axis; effectively infinite. */
const WINDOW_DAYS = 1500;
/** Drag-select snapping (minutes). */
const SNAP = 15;

export interface DayTimelineProps {
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	/** Zoom (px per hour), owned by the Calendar island. */
	pxPerHour: Signal<number>;
	/** Live now (epoch ms) — the now-line + return-to-present. */
	nowMs: number;
	/** The focused day (epoch ms) — drives nav jumps; reported back as the scroll centre moves. */
	focusMs: number;
	mounted: boolean;
	canCreate?: boolean;
	onSelectRange?: (range: CalendarRange) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
	/** Fired (day-granular) as the scroll centre crosses into a new day, so the header + mini-map track it. */
	onFocusDayChange?: (dayMs: number) => void;
}

export function DayTimeline(props: DayTimelineProps): JSX.Element {
	const { tz, hour12, pxPerHour, nowMs, mounted } = props;

	// Fixed axis origin (index 0 = the day focused on MOUNT). NEVER re-based on scroll, so element
	// positions stay stable; nav/mini-map jumps scroll WITHIN the ±WINDOW_DAYS window (which spans years).
	const refMidnight = useRef(startOfDay(props.focusMs, tz)).current;
	const RANGE_START_MIN = -WINDOW_DAYS * 24 * 60;
	const RANGE_END_MIN = (WINDOW_DAYS + 1) * 24 * 60;

	const minuteOf = (ms: number) => (ms - refMidnight) / MIN;
	const dayIndexOf = (ms: number) => Math.round((startOfDay(ms, tz) - refMidnight) / DAY);

	// Initial centre: the live time when the focus IS today, else the focus day's noon (so the day view
	// opens on the same reference the rest of the calendar is built around — the now-line stays live).
	const centerAnchorMin = sameZonedDay(props.focusMs, nowMs, tz)
		? minuteOf(nowMs)
		: minuteOf(startOfDay(props.focusMs, tz)) + 12 * 60;

	const viewport = useCalendarViewport({
		pxPerHour,
		rangeStartMin: RANGE_START_MIN,
		rangeEndMin: RANGE_END_MIN,
		nowY: () => ((minuteOf(nowMs) - RANGE_START_MIN) / 60) * pxPerHour.value,
		focusY: () => ((centerAnchorMin - RANGE_START_MIN) / 60) * pxPerHour.value,
	});

	const pph = pxPerHour.value;
	const yFor = (m: number) => ((m - RANGE_START_MIN) / 60) * pph;
	const minAt = (y: number) => RANGE_START_MIN + (y / pph) * 60;

	// The last day we emitted / navigated to — breaks the focus↔scroll feedback loop.
	const lastDay = useRef(refMidnight);

	// #region Centre-day tracking (scroll → header/mini-map)
	useSignalEffect(() => {
		const top = viewport.scrollTop.value;
		const h = viewport.viewportH.value;
		if (h <= 0) return;
		const centerMs = refMidnight + minAt(top + h / 2) * MIN;
		const day = startOfDay(centerMs, tz);
		if (day !== lastDay.current) {
			lastDay.current = day;
			props.onFocusDayChange?.(day);
		}
	});
	// #endregion

	// #region Nav jumps (focus changed externally → scroll to it; ignore our own echo)
	useEffect(() => {
		const el = viewport.scrollRef.current;
		if (!el) return;
		const targetDay = startOfDay(props.focusMs, tz);
		if (targetDay === lastDay.current) return; // our own centre echo, or unchanged
		lastDay.current = targetDay;
		const isToday = sameZonedDay(targetDay, nowMs, tz);
		const anchorMin = isToday ? minuteOf(nowMs) : minuteOf(targetDay) + 12 * 60;
		el.scrollTo({ top: Math.max(0, yFor(anchorMin) - el.clientHeight / 2), behavior: "smooth" });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [props.focusMs]);
	// #endregion

	// #region Click / drag-to-select
	const sel = useSignal<{ a: number; b: number } | null>(null);
	function snapMs(ms: number): number {
		const step = SNAP * MIN;
		return Math.round(ms / step) * step;
	}
	function msAt(clientY: number): number {
		const el = viewport.scrollRef.current;
		if (!el) return refMidnight;
		const rect = el.getBoundingClientRect();
		return refMidnight + minAt(clientY - rect.top + el.scrollTop) * MIN;
	}
	function onCreatePointerDown(e: PointerEvent): void {
		if (!props.canCreate || e.button !== 0 || e.ctrlKey || e.metaKey) return;
		const a = snapMs(msAt(e.clientY));
		sel.value = { a, b: a + 30 * MIN };
		const move = (ev: PointerEvent) => {
			if (sel.value) sel.value = { ...sel.value, b: snapMs(msAt(ev.clientY)) };
		};
		const up = () => {
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			const s = sel.value;
			sel.value = null;
			if (!s) return;
			const lo = Math.min(s.a, s.b);
			const hi = Math.max(s.a, s.b);
			const dur = hi - lo < SNAP * MIN ? 60 * MIN : hi - lo;
			props.onSelectRange?.({ start: lo, end: lo + dur });
		};
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
	}
	// #endregion

	// #region Visible-day window
	const top = viewport.scrollTop.value;
	const h = viewport.viewportH.value || 1;
	const startIdx = Math.max(-WINDOW_DAYS, Math.floor((minAt(top) * MIN) / DAY) - 1);
	const endIdx = Math.min(WINDOW_DAYS, Math.ceil((minAt(top + h) * MIN) / DAY) + 1);
	const nowIdx = dayIndexOf(nowMs);

	const days: number[] = [];
	for (let i = startIdx; i <= endIdx; i++) days.push(i);
	// #endregion

	return (
		<div class={cx("cal-tg", "cal-tg--timeline")}>
			<div
				class={cx("cal-tg__scroll", viewport.panning.value && "cal-tg__scroll--panning")}
				ref={viewport.scrollRef}
				onPointerDown={viewport.onPanPointerDown}
			>
				<div
					class="cal-tg__content"
					style={styleVars({ "--cal-content-h": `${viewport.contentHeight.value}px` })}
				>
					<div class="cal-tg__gutter" aria-hidden="true">
						{days.map((i) => {
							const dayStart = addZonedDays(refMidnight, i, tz);
							const dayTop = yFor(minuteOf(dayStart));
							return Array.from({ length: 24 }, (_, hr) => (
								<div
									key={`${i}-${hr}`}
									class="cal-tg__hour"
									style={styleVars({ "--cal-top": `${dayTop + hr * pph}px` })}
								>
									<span class="cal-tg__hour-label">{fmtHourLabel(hr, hour12)}</span>
								</div>
							));
						})}
					</div>

					<div class="cal-tg__lines" aria-hidden="true">
						{days.map((i) => {
							const dayStart = addZonedDays(refMidnight, i, tz);
							const dayTop = yFor(minuteOf(dayStart));
							return Array.from({ length: 24 }, (_, hr) => (
								<div
									key={`${i}-${hr}`}
									class={cx("cal-tg__line", hr === 0 && "cal-tg__line--day")}
									style={styleVars({ "--cal-top": `${dayTop + hr * pph}px` })}
								/>
							));
						})}
					</div>

					<div class="cal-tg__cols" style={styleVars({ "--cal-cols": "minmax(0, 1fr)" })}>
						<div class="cal-tg__col cal-tg__col--timeline">
							<div
								class="cal-daycol__hit"
								onPointerDown={(e) => onCreatePointerDown(e as unknown as PointerEvent)}
							/>

							{/* Day dividers + date labels */}
							{days.map((i) => {
								const dayStart = addZonedDays(refMidnight, i, tz);
								return (
									<div
										key={`d${i}`}
										class={cx(
											"cal-tg__daymark",
											i === nowIdx && mounted && "cal-tg__daymark--today",
										)}
										style={styleVars({ "--cal-top": `${yFor(minuteOf(dayStart))}px` })}
									>
										{fmtDayLabel(dayStart, tz)}
									</div>
								);
							})}

							{/* Availability working-hours bands */}
							{props.availability
								? days.flatMap((i) => {
									const dayStart = addZonedDays(refMidnight, i, tz);
									const dayTop = yFor(minuteOf(dayStart));
									const wd = zonedWeekday(dayStart, tz);
									return props.availability!.rules
										.filter((r) => r.weekday === wd)
										.map((r, k) => (
											<div
												key={`a${i}-${k}`}
												class="cal-daycol__avail"
												style={styleVars({
													"--cal-top": `${dayTop + (r.startMinute / 60) * pph}px`,
													"--cal-h": `${((r.endMinute - r.startMinute) / 60) * pph}px`,
												})}
												aria-hidden="true"
											/>
										));
								})
								: null}

							{/* Events (packed per day) */}
							{days.flatMap((i) => {
								const dayStart = addZonedDays(refMidnight, i, tz);
								const nextDay = addZonedDays(dayStart, 1, tz);
								const dayEvents = props.events.filter((e) =>
									!e.allDay && e.start < nextDay && e.end > dayStart
								);
								return packDayEvents(dayEvents).map(({ event, col, cols, span }) => {
									const startMs = Math.max(event.start, dayStart);
									const endMs = Math.min(event.end, nextDay);
									const t = yFor(minuteOf(startMs));
									const hgt = Math.max(yFor(minuteOf(endMs)) - t, 14);
									return (
										<div
											key={event.id}
											class="cal-daycol__event"
											style={styleVars({
												"--cal-top": `${t}px`,
												"--cal-h": `${hgt}px`,
												"--cal-left": `${(col / cols) * 100}%`,
												"--cal-w": `${(span / cols) * 100}%`,
											})}
										>
											<EventBlock
												event={event}
												tz={tz}
												hour12={hour12}
												roomy={hgt >= 40}
												onOpen={props.onOpenEvent}
											/>
										</div>
									);
								});
							})}

							{/* Drag-select preview */}
							{sel.value
								? (
									<div
										class="cal-tg__selection"
										style={styleVars({
											"--cal-top": `${yFor(minuteOf(Math.min(sel.value.a, sel.value.b)))}px`,
											"--cal-h": `${
												Math.max(
													yFor(minuteOf(Math.max(sel.value.a, sel.value.b))) -
														yFor(minuteOf(Math.min(sel.value.a, sel.value.b))),
													6,
												)
											}px`,
										})}
										aria-hidden="true"
									/>
								)
								: null}

							{/* Now-line */}
							{mounted && nowIdx >= startIdx && nowIdx <= endIdx
								? (
									<div
										class="cal-daycol__now"
										style={styleVars({ "--cal-top": `${yFor(minuteOf(nowMs))}px` })}
										aria-hidden="true"
									>
										<span class="cal-daycol__now-dot" />
									</div>
								)
								: null}
						</div>
					</div>
				</div>
			</div>

			{viewport.awayFromNow.value
				? (
					<button
						type="button"
						class={cx("cal-tg__present", `cal-tg__present--${viewport.awayFromNow.value}`)}
						onClick={() => viewport.scrollToNow()}
					>
						<TodayIcon size={15} />
						<span>Now</span>
					</button>
				)
				: null}
		</div>
	);
}
