/**
 * @projective/ui/calendar — the Day / Week time grid. Composes {@link useCalendarViewport} (the
 * virtualized, centered, pannable vertical scroll), a sticky column-header row + all-day lane, the
 * virtualized hour gutter + grid lines, one {@link DayColumn} per shown day, click / drag-to-select on
 * empty cells, and the floating Return-to-present pill. Day view is a 1-column grid; Week view a
 * 7-column grid — same engine.
 */
import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import type { CalendarAvailability, CalendarEvent, CalendarRange } from "../core/types.ts";
import {
	DAY,
	fmtHourLabel,
	MIN,
	minutesFromDayStart,
	sameZonedDay,
	startOfDay,
	weekdayLabels,
	zonedDayNum,
	zonedWeekday,
} from "../core/time.ts";
import { gridGeometry, useCalendarViewport } from "../hooks/useCalendarViewport.ts";
import { DayColumn, type WorkingWindow } from "./DayColumn.tsx";
import { EventBlock } from "./EventBlock.tsx";
import { TodayIcon } from "./glyphs.tsx";

/** Overscroll pad (hours) above midnight and past 24h — makes crossing midnight seamless. */
const PAD_HOURS = 3;
const RANGE_START_MIN = -PAD_HOURS * 60;
const RANGE_END_MIN = 24 * 60 + PAD_HOURS * 60;
/** Drag-select snapping (minutes). */
const SNAP = 15;

export interface TimeGridProps {
	/** Day-midnight epochs to render (1 for day view, 7 for week). */
	days: number[];
	tz: string;
	hour12: boolean;
	events: CalendarEvent[];
	availability?: CalendarAvailability;
	/** Zoom (px per hour), owned by the Calendar island. */
	pxPerHour: Signal<number>;
	/** Live now (epoch ms) from the island's now-ticker — drives the now-line + return-to-present. */
	nowMs: number;
	/** Whether the client has mounted (gates the now-line + centering-on-now). */
	mounted: boolean;
	canCreate?: boolean;
	onSelectRange?: (range: CalendarRange) => void;
	onOpenEvent?: (event: CalendarEvent) => void;
}

export function TimeGrid(props: TimeGridProps): JSX.Element {
	const { days, tz, hour12, pxPerHour, nowMs, mounted } = props;

	// Live drag-selection preview: { day index, minute a, minute b }.
	const sel = useSignal<{ day: number; a: number; b: number } | null>(null);

	// The now-line uses the LIVE clock. The initial scroll centres on the current time-of-day when the
	// focused period contains today; otherwise on the exact CENTRE of the time scale (noon) — symmetric
	// room to scroll up into the morning and down across midnight (§Part 1.2). Both are stable at the
	// time the (single, latched) centering runs, so it is deterministic.
	const nowMinute = minutesFromDayStart(nowMs, startOfDay(nowMs, tz));
	const todayInView = mounted && days.some((d) => sameZonedDay(d, nowMs, tz));
	const centerMinute = todayInView ? nowMinute : 12 * 60;

	const viewport = useCalendarViewport({
		pxPerHour,
		rangeStartMin: RANGE_START_MIN,
		rangeEndMin: RANGE_END_MIN,
		nowY: () => ((nowMinute - RANGE_START_MIN) / 60) * pxPerHour.value,
		focusY: () => ((centerMinute - RANGE_START_MIN) / 60) * pxPerHour.value,
	});

	const geo = gridGeometry(pxPerHour.value, RANGE_START_MIN);

	// #region Availability per day
	function windowsFor(dayStart: number): WorkingWindow[] {
		if (!props.availability) return [];
		const wd = zonedWeekday(dayStart, tz);
		return props.availability.rules
			.filter((r) => r.weekday === wd)
			.map((r) => ({ startMinute: r.startMinute, endMinute: r.endMinute }));
	}
	function isBlackout(dayStart: number): boolean {
		if (!props.availability) return false;
		const end = dayStart + DAY;
		return props.availability.blackouts.some((b) => b.start < end && b.end > dayStart);
	}
	// #endregion

	// #region Click / drag-to-select
	function minuteAt(clientY: number): number {
		const el = viewport.scrollRef.current;
		if (!el) return 0;
		const rect = el.getBoundingClientRect();
		const contentY = clientY - rect.top + el.scrollTop;
		const raw = RANGE_START_MIN + (contentY / pxPerHour.value) * 60;
		return Math.round(raw / SNAP) * SNAP;
	}

	function onCreatePointerDown(dayStart: number, e: PointerEvent): void {
		if (!props.canCreate) return;
		if (e.button !== 0 || e.ctrlKey || e.metaKey) return; // leave middle/ctrl-drag to the pan handler
		const dayIdx = days.indexOf(dayStart);
		const startMin = clampDayMinute(minuteAt(e.clientY));
		sel.value = { day: dayIdx, a: startMin, b: startMin + 30 };

		const move = (ev: PointerEvent) => {
			if (!sel.value) return;
			sel.value = { ...sel.value, b: clampDayMinute(minuteAt(ev.clientY)) };
		};
		const up = () => {
			globalThis.removeEventListener("pointermove", move);
			globalThis.removeEventListener("pointerup", up);
			const s = sel.value;
			sel.value = null;
			if (!s) return;
			const lo = Math.min(s.a, s.b);
			const hi = Math.max(s.a, s.b);
			const dur = hi - lo < SNAP ? 60 : hi - lo; // a bare click → a default 60-min slot
			props.onSelectRange?.({ start: dayStart + lo * MIN, end: dayStart + (lo + dur) * MIN });
		};
		globalThis.addEventListener("pointermove", move);
		globalThis.addEventListener("pointerup", up);
	}
	function clampDayMinute(m: number): number {
		return Math.max(0, Math.min(24 * 60, m));
	}
	// #endregion

	const gutterLabels = viewport.rows.value;
	const hasAllDay = props.events.some((e) =>
		e.allDay && days.some((d) => e.start < d + DAY && e.end > d)
	);
	const colTemplate = `repeat(${days.length}, minmax(0, 1fr))`;

	return (
		<div class={cx("cal-tg", `cal-tg--${days.length === 1 ? "day" : "week"}`)}>
			{/* Column header row (sticky) */}
			<div class="cal-tg__head">
				<div class="cal-tg__gutter-head" aria-hidden="true" />
				<div class="cal-tg__headcols" style={styleVars({ "--cal-cols": colTemplate })}>
					{days.map((d) => {
						const today = mounted && sameZonedDay(d, nowMs, tz);
						return (
							<div key={d} class={cx("cal-tg__daycell", today && "cal-tg__daycell--today")}>
								<span class="cal-tg__daydow">{weekdayLabels()[(zonedWeekday(d, tz) + 6) % 7]}</span>
								<span class="cal-tg__daynum">{zonedDayNum(d, tz)}</span>
							</div>
						);
					})}
				</div>
			</div>

			{/* All-day lane */}
			{hasAllDay
				? (
					<div class="cal-tg__allday">
						<div class="cal-tg__gutter-head cal-tg__allday-label">All-day</div>
						<div class="cal-tg__headcols" style={styleVars({ "--cal-cols": colTemplate })}>
							{days.map((d) => (
								<div key={d} class="cal-tg__allday-col">
									{props.events
										.filter((e) => e.allDay && e.start < d + DAY && e.end > d)
										.map((e) => (
											<EventBlock
												key={e.id}
												event={e}
												tz={tz}
												hour12={hour12}
												compact
												onOpen={props.onOpenEvent}
											/>
										))}
								</div>
							))}
						</div>
					</div>
				)
				: null}

			{/* Scrollable time area */}
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
						{gutterLabels.map((r) => (
							<div key={r.hour} class="cal-tg__hour" style={styleVars({ "--cal-top": `${r.y}px` })}>
								<span class="cal-tg__hour-label">{fmtHourLabel(r.hourOfDay, hour12)}</span>
							</div>
						))}
					</div>

					<div class="cal-tg__lines" aria-hidden="true">
						{gutterLabels.map((r) => (
							<div
								key={r.hour}
								class={cx("cal-tg__line", r.dayBoundary && "cal-tg__line--day")}
								style={styleVars({ "--cal-top": `${r.y}px` })}
							/>
						))}
					</div>

					<div class="cal-tg__cols" style={styleVars({ "--cal-cols": colTemplate })}>
						{days.map((d) => (
							<div key={d} class="cal-tg__col">
								<DayColumn
									dayStart={d}
									tz={tz}
									hour12={hour12}
									events={props.events}
									pxPerHour={pxPerHour.value}
									rangeStartMin={RANGE_START_MIN}
									rangeEndMin={RANGE_END_MIN}
									workingWindows={windowsFor(d)}
									blackout={isBlackout(d)}
									isToday={mounted && sameZonedDay(d, nowMs, tz)}
									nowMinuteOfDay={mounted && sameZonedDay(d, nowMs, tz)
										? minutesFromDayStart(nowMs, d)
										: null}
									onOpenEvent={props.onOpenEvent}
									onCreatePointerDown={onCreatePointerDown}
								/>
								{sel.value && days[sel.value.day] === d
									? (
										<div
											class="cal-tg__selection"
											style={styleVars({
												"--cal-top": `${geo.yFor(Math.min(sel.value.a, sel.value.b))}px`,
												"--cal-h": `${
													Math.max(geo.hFor(Math.abs(sel.value.b - sel.value.a)), 6)
												}px`,
											})}
											aria-hidden="true"
										/>
									)
									: null}
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Return-to-present pill */}
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
