import type { JSX } from "preact";
import { type Signal, useComputed, useSignal } from "@preact/signals";
import { Button } from "../../../fields/components/Button.tsx";
import { Tooltip } from "../../../feedback/islands/Tooltip.tsx";
import { Icon } from "../../../icons/components/Icon.tsx";
import Calendar from "../Calendar.tsx";
import { CalendarZoom } from "../../components/CalendarZoom.tsx";
import { dailyOccurrences, minuteOfDay } from "../../core/series.ts";
import {
	addZonedDays,
	addZonedMonths,
	DAY,
	fmtDayLabel,
	fmtFullDate,
	fmtMonthYear,
	weekDays,
	zonedWeekday,
} from "../../core/time.ts";
import type {
	CalendarContextTarget,
	CalendarEvent,
	CalendarRange,
	CalendarViewMode,
} from "../../core/types.ts";
import { CALENDAR_ZOOM_DEFAULT } from "../../core/zoom.ts";
import { addDays, todayIn } from "./civil.ts";
import { useScheduler } from "./context.ts";
import { isCanvasRule } from "./reducer.ts";
import type { Occurrence, RuleDraft, Weekday } from "./types.ts";

/** Days evaluated either side of the focus: wider than the Month view's ten weeks. */
const BEFORE_DAYS = 42;
const AFTER_DAYS = 84;

/**
 * The colour a span is drawn in: the swatch every rule that drew it shares (Decision #408), else the
 * SOLID default hours fill (`--cal-ev-hours`, declared on `.ui-avsched`) — never the open-slot
 * `--info` wash a bookable slot takes elsewhere. A span joining rules of different colours is drawn
 * in the default, since it is none of them.
 */
function accentOf(ruleIds: readonly string[], rules: readonly RuleDraft[]): string {
	const tokens = new Set(ruleIds.map((id) => rules.find((r) => r.id === id)?.colorToken ?? null));
	const [only] = tokens;
	return tokens.size === 1 && only ? only : "--cal-ev-hours";
}

/** One evaluated span as a calendar entry; its id keys back to the rules that made it. */
function toEvent(o: Occurrence, rules: readonly RuleDraft[]): CalendarEvent {
	return {
		id: `${o.kind}:${o.startsAt}`,
		title: "Working hours",
		kind: "availability",
		accent: accentOf(o.ruleIds, rules),
		start: o.startsAt,
		end: o.endsAt,
	};
}

/**
 * What a right-click on the scheduler's grid landed on: the rule a span came from (the first, where
 * several make one span), or an empty slot's weekday and minute (`null` minute for a whole Month day).
 */
export interface SchedulerContextTarget {
	ruleId: string | null;
	slot: { day: Weekday; minute: number | null } | null;
}

/** Props for `AvailabilityScheduler.Calendar`. */
export interface CalendarViewProps {
	/**
	 * Draw the built-in bar — period, undo, redo, zoom (default `true`). A host that draws those
	 * controls in its own chrome passes `false` and owns `focus`, `view` and `zoom`.
	 */
	bar?: boolean;
	/**
	 * The focused instant, owned by the host (default: local, starting now). `0` reads as now, so a
	 * host can hold it in module state without seeding it from a clock during a server render.
	 */
	focus?: Signal<number>;
	/** Day · Week · Month, owned by the host (default: local, Week). */
	view?: Signal<CalendarViewMode>;
	/** The calendar zoom, owned by the host (default: local). */
	zoom?: Signal<number>;
	/** Bumped by the host to centre the now-line (`CalendarProps.present`). */
	present?: Signal<number>;
	/**
	 * Told what a right-click (or the ContextMenu key) landed on, before the event bubbles to the
	 * host's own menu surface (`CalendarProps.onContextTarget`, in rule terms).
	 */
	onContextTarget?: (target: SchedulerContextTarget) => void;
}

/**
 * The scheduler on the shared Calendar engine — the `/calendar` grid with its zoom, from a day's
 * hours through the week (the default) to months with every rule applied. Spans come from the
 * engine's `evaluate()` over a window around the focus, each in its rules' swatch. Drag on empty time
 * adds working hours; a span opens its rule in the editor; dragging a span of one weekly rule moves
 * that band.
 */
export function CalendarView(props: CalendarViewProps = {}): JSX.Element {
	const { store, timezone } = useScheduler();
	const tz = timezone;
	const ownFocus = useSignal(Date.now());
	const ownView = useSignal<CalendarViewMode>("week");
	const ownZoom = useSignal(CALENDAR_ZOOM_DEFAULT);
	const focus = props.focus ?? ownFocus;
	const view = props.view ?? ownView;
	const zoom = props.zoom ?? ownZoom;

	const spans = useComputed(() => {
		const from = addDays(todayIn(tz, focus.value || Date.now()), -BEFORE_DAYS);
		return store.engine.evaluate(store.draft.value, {
			from,
			to: addDays(from, BEFORE_DAYS + AFTER_DAYS),
		});
	});
	const rulesOf = useComputed(() =>
		new Map(spans.value.map((o) => [`${o.kind}:${o.startsAt}`, o.ruleIds]))
	);
	const events = useComputed(() => spans.value.map((o) => toEvent(o, store.draft.value.rules)));

	const v = view.value;
	const f = focus.value || Date.now();
	const days = weekDays(f, tz);
	const period = v === "day"
		? fmtFullDate(f, tz)
		: v === "week"
		? `${fmtDayLabel(days[0], tz)} – ${fmtDayLabel(days[6], tz)}`
		: fmtMonthYear(f, tz);
	const step = (delta: number) => {
		focus.value = v === "day"
			? addZonedDays(f, delta, tz)
			: v === "week"
			? addZonedDays(f, delta * 7, tz)
			: addZonedMonths(f, delta, tz);
	};

	const onSelectRange = (range: CalendarRange) => {
		if (range.allDay) return;
		for (const part of dailyOccurrences(range, tz)) {
			const start = minuteOfDay(part.start, tz);
			const minutes = Math.min(DAY, part.end - part.start) / 60_000;
			store.createBand(zonedWeekday(part.start, tz) as Weekday, start, start + minutes);
		}
	};

	const onOpenEvent = (event: CalendarEvent) => {
		const ruleId = rulesOf.value.get(event.id)?.[0];
		if (ruleId) store.dispatch({ type: "edit", ruleId });
	};

	const onContextTarget = props.onContextTarget &&
		((t: CalendarContextTarget) => {
			const r = t.range;
			props.onContextTarget?.({
				ruleId: t.event ? rulesOf.value.get(t.event.id)?.[0] ?? null : null,
				slot: r
					? {
						day: zonedWeekday(r.start, tz) as Weekday,
						minute: r.allDay ? null : minuteOfDay(r.start, tz),
					}
					: null,
			});
		});

	const onMoveEvent = (event: CalendarEvent, range: CalendarRange) => {
		const ids = rulesOf.value.get(event.id) ?? [];
		const rule = ids.length === 1
			? store.draft.peek().rules.find((r) => r.id === ids[0])
			: undefined;
		if (!rule || !isCanvasRule(rule)) return;
		const from = minuteOfDay(event.start, tz);
		const bandIndex = rule.bands.findIndex((b) => b.start === from);
		if (bandIndex < 0) return;
		store.moveBand(
			{ ruleId: rule.id, bandIndex, day: zonedWeekday(event.start, tz) as Weekday },
			zonedWeekday(range.start, tz) as Weekday,
			minuteOfDay(range.start, tz) - from,
		);
	};

	return (
		<div class="ui-avsched__cal">
			{props.bar !== false && (
				<div class="ui-avsched__cal-bar" role="group" aria-label="Calendar tools">
					<div class="ui-avsched__cal-nav">
						<Tooltip content="Today" density="compact">
							<Button
								variant="text"
								size="sm"
								iconOnly
								icon={<Icon name="calendar" />}
								aria-label="Go to today"
								onClick={() => (focus.value = Date.now())}
							/>
						</Tooltip>
						<Tooltip content="Previous" density="compact">
							<Button
								variant="text"
								size="sm"
								iconOnly
								icon={<Icon name="chevron-left" />}
								aria-label="Previous"
								onClick={() =>
									step(-1)}
							/>
						</Tooltip>
						<Tooltip content="Next" density="compact">
							<Button
								variant="text"
								size="sm"
								iconOnly
								icon={<Icon name="chevron-right" />}
								aria-label="Next"
								onClick={() =>
									step(1)}
							/>
						</Tooltip>
						<h3 class="ui-avsched__cal-period" aria-live="polite">{period}</h3>
					</div>
					<div class="ui-avsched__cal-tools">
						<Tooltip content="Undo" density="compact">
							<Button
								variant="text"
								size="sm"
								iconOnly
								icon={<Icon name="rotate-ccw" />}
								aria-label="Undo"
								aria-keyshortcuts="Control+Z"
								disabled={!store.canUndo.value}
								onClick={store.undo}
							/>
						</Tooltip>
						<Tooltip content="Redo" density="compact">
							<Button
								variant="text"
								size="sm"
								iconOnly
								icon={<Icon name="rotate-cw" />}
								aria-label="Redo"
								aria-keyshortcuts="Control+Shift+Z"
								disabled={!store.canRedo.value}
								onClick={store.redo}
							/>
						</Tooltip>
						<CalendarZoom
							mode="calendar"
							value={zoom.value}
							onValueChange={(u) => (zoom.value = u)}
							size="sm"
						/>
					</div>
				</div>
			)}
			<div class="ui-avsched__cal-view">
				<Calendar
					events={events.value}
					timezone={tz}
					view={v}
					focus={f}
					zoom={zoom}
					present={props.present}
					hideHeader
					hideSidePanel
					directOpen
					canCreate
					onSelectRange={onSelectRange}
					onOpenEvent={onOpenEvent}
					onMoveEvent={onMoveEvent}
					onContextTarget={onContextTarget}
					onViewChange={(next) => (view.value = next)}
					onFocusChange={(ms) => (focus.value = ms)}
				/>
			</div>
		</div>
	);
}
