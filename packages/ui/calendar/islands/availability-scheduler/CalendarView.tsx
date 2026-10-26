import type { JSX } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { Button } from "../../../fields/components/Button.tsx";
import { SelectButton } from "../../../fields/islands/SelectButton.tsx";
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
import type { CalendarEvent, CalendarRange, CalendarViewMode } from "../../core/types.ts";
import { CALENDAR_ZOOM_DEFAULT } from "../../core/zoom.ts";
import { addDays, todayIn } from "./civil.ts";
import { pickOption, useBound, useScheduler } from "./context.ts";
import { isCanvasRule } from "./reducer.ts";
import type { Layer, Occurrence, Weekday } from "./types.ts";

const LAYERS: { label: string; value: Layer }[] = [
	{ label: "Hours", value: "working_hours" },
	{ label: "Calls", value: "call_window" },
];

/** Days evaluated either side of the focus: wider than the Month view's ten weeks. */
const BEFORE_DAYS = 42;
const AFTER_DAYS = 84;

/** One evaluated span as a calendar entry; its id keys back to the rules that made it. */
function toEvent(o: Occurrence): CalendarEvent {
	const working = o.kind === "working_hours";
	return {
		id: `${o.kind}:${o.startsAt}`,
		title: working ? "Working hours" : "Calls",
		kind: working ? "availability" : "session",
		start: o.startsAt,
		end: o.endsAt,
	};
}

/**
 * The scheduler on the shared Calendar engine — the `/calendar` grid with its zoom, from a day's
 * hours through the week (the default) to months with every rule applied. Spans come from the
 * engine's `evaluate()` over a window around the focus, for the active layer (Hours or Calls). Drag on
 * empty time adds a band on that layer; a span opens its rule in the editor; dragging a span of one
 * weekly rule moves that band.
 */
export function CalendarView(): JSX.Element {
	const { store, timezone } = useScheduler();
	const tz = timezone;
	const focus = useSignal(Date.now());
	const view = useSignal<CalendarViewMode>("week");
	const zoom = useSignal(CALENDAR_ZOOM_DEFAULT);
	const layer = useBound(store.layer, (v): string => v);

	const spans = useComputed(() => {
		const from = addDays(todayIn(tz, focus.value), -BEFORE_DAYS);
		return store.engine.evaluate(store.draft.value, {
			from,
			to: addDays(from, BEFORE_DAYS + AFTER_DAYS),
		});
	});
	const rulesOf = useComputed(() => new Map(spans.value.map((o) => [toEvent(o).id, o.ruleIds])));
	// One layer at a time: call windows sit inside working hours, and drawn together the grid folds
	// them into the working-hours card where they cannot be read or picked.
	const events = useComputed(() =>
		spans.value.filter((o) => o.kind === store.layer.value).map(toEvent)
	);

	const v = view.value;
	const f = focus.value;
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
			<div class="ui-avsched__cal-bar" role="group" aria-label="Calendar tools">
				<div class="ui-avsched__cal-nav">
					<Tooltip content="Today">
						<Button
							variant="text"
							size="sm"
							iconOnly
							icon={<Icon name="calendar" />}
							aria-label="Go to today"
							onClick={() => (focus.value = Date.now())}
						/>
					</Tooltip>
					<Tooltip content="Previous">
						<Button
							variant="text"
							size="sm"
							iconOnly
							icon={<Icon name="chevron-left" />}
							aria-label="Previous"
							onClick={() => step(-1)}
						/>
					</Tooltip>
					<Tooltip content="Next">
						<Button
							variant="text"
							size="sm"
							iconOnly
							icon={<Icon name="chevron-right" />}
							aria-label="Next"
							onClick={() => step(1)}
						/>
					</Tooltip>
					<h3 class="ui-avsched__cal-period" aria-live="polite">{period}</h3>
				</div>
				<div class="ui-avsched__cal-tools">
					<SelectButton
						options={LAYERS}
						value={layer}
						onValueChange={(next) => {
							const picked = pickOption(LAYERS, next);
							if (picked) store.setLayer(picked);
						}}
						aria-label="Layer"
						size="sm"
					/>
					<Tooltip content="Undo">
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
					<Tooltip content="Redo">
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
			<div class="ui-avsched__cal-view">
				<Calendar
					events={events.value}
					timezone={tz}
					view={v}
					focus={f}
					zoom={zoom}
					hideHeader
					hideSidePanel
					directOpen
					canCreate
					onSelectRange={onSelectRange}
					onOpenEvent={onOpenEvent}
					onMoveEvent={onMoveEvent}
					onViewChange={(next) => (view.value = next)}
					onFocusChange={(ms) => (focus.value = ms)}
				/>
			</div>
		</div>
	);
}
