import type { JSX, RefObject, VNode } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { signal, useSignalEffect } from "@preact/signals";
import "../styles/datepicker.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { useFloating } from "../hooks/useFloating.ts";
import { useDismiss } from "../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import {
	clampDayToMonth,
	formatDatePattern,
	MONTH_NAMES,
	toLocalIsoDate,
	WEEKDAY_NAMES,
} from "../core/datetime.ts";
import {
	type DateParts,
	type DateSegmentKind,
	emptyParts,
	parseSegmentLayout,
	partsFromDate,
	partsToDate,
} from "../core/date-segments.ts";
import { DateSegmentedInput } from "../components/DateSegmentedInput.tsx";
import { CalendarHeader } from "../components/CalendarHeader.tsx";
import { CalendarMonthTrack } from "../components/CalendarMonthTrack.tsx";
import type { BaseFieldProps, Bindable, Option, ValueChange } from "../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Types

/** Selection cardinality. `single` → one date, `multiple` → a set, `range` → `[start, end]`. */
export type DateSelectionMode = "single" | "multiple" | "range";

/** The bound value shape: a single date (or null), or an array (multiple / range). */
export type DateValue = Date | Date[] | null;

/** Custom day-cell renderer — receives the cell's date, returns the inner content. */
export type DateTemplate = (date: Date) => VNode | string;

/** Which part of the control keyboard focus currently belongs to. */
type FocusOwner = "segments" | "grid" | null;

export interface DatePickerProps extends BaseFieldProps {
	/** Bound value — raw (uncontrolled) or `Signal` (controlled). `Date|null`, or `Date[]`. */
	value?: Bindable<DateValue>;
	/** Fired whenever the selection changes. */
	onValueChange?: ValueChange<DateValue>;
	/** Selection cardinality (default `single`). */
	selectionMode?: DateSelectionMode;
	/** Render the calendar inline instead of in a popup over an input. */
	inline?: boolean;
	/** Show hour/minute/second selects (+ AM/PM when `hourFormat` is `12`). */
	showTime?: boolean;
	/** Clock convention for the time picker (default `24`). */
	hourFormat?: "12" | "24";
	/** Render N side-by-side month grids (default `1`). */
	numberOfMonths?: number;
	/** Earliest selectable date (inclusive). */
	minDate?: Date;
	/** Latest selectable date (inclusive). */
	maxDate?: Date;
	/** Explicit list of non-selectable dates. */
	disabledDates?: Date[];
	/** Display format tokens: `d dd D DD m mm M MM yy yyyy` (default `mm/dd/yy`). */
	dateFormat?: string;
	/**
	 * Type the date directly, in `DD` / `MM` / `YYYY` boxes (default `true` for `single`).
	 *
	 * Ignored for `multiple` and `range`, which name two dates or many and so have nothing three
	 * boxes can hold; those keep the read-only display. Set `false` to opt a single-date picker back
	 * out — the calendar remains the only way in.
	 */
	segmented?: boolean;
	/** First day of the week: `0` Sun … `1` Mon (default `1`). */
	firstDayOfWeek?: 0 | 1;
	/**
	 * How many years the year picker offers either side of the current year (default `100`).
	 *
	 * `minDate`/`maxDate` still bound the list on the side they constrain — a date of birth with
	 * `maxDate={new Date()}` gets exactly one century back and nothing forward — and the year currently
	 * in view is always included, so navigating past the span can never strand the control with no
	 * matching option.
	 */
	yearSpan?: number;
	/** Input placeholder. The segmented presentation shows its own per-segment placeholders. */
	placeholder?: string;
	/** Show a Today / Clear button bar under the grid. */
	showButtonBar?: boolean;
	/** Show a calendar icon trigger inside the input (popup mode). */
	showIcon?: boolean;
	/** Custom day-cell content. */
	dateTemplate?: DateTemplate;
	/** Extra content rendered above the grid. */
	headerTemplate?: VNode;
	/** Extra content rendered below the grid (above the button bar). */
	footerTemplate?: VNode;
	class?: string;
}

// #endregion

// #region Date math helpers

/** Midnight copy of a date (strips time). */
function atMidnight(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Same calendar day? */
function isSameDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
	return !!a && !!b &&
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate();
}

/** First day of the month containing `d`. */
function startOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Shift a date by whole months, clamping the day. */
function addMonths(d: Date, delta: number): Date {
	return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/** Shift a date by whole days. */
function addDays(d: Date, delta: number): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
}

/** Absolute month number, so two months compare without wrap arithmetic. */
function monthIndex(d: Date): number {
	return d.getFullYear() * 12 + d.getMonth();
}

/** Stable per-day key for lookups / focus targeting. */
function dayKey(d: Date): string {
	return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Build the 6×7 day matrix for a month, including leading/trailing days of the adjacent months so
 * every week row is full. `firstDayOfWeek`: 0 Sun / 1 Mon.
 */
function monthMatrix(year: number, month: number, firstDayOfWeek: number): Date[][] {
	const first = new Date(year, month, 1);
	const offset = (first.getDay() - firstDayOfWeek + 7) % 7;
	const start = addDays(first, -offset);
	const weeks: Date[][] = [];
	let cursor = start;
	for (let w = 0; w < 6; w++) {
		const row: Date[] = [];
		for (let d = 0; d < 7; d++) {
			row.push(cursor);
			cursor = addDays(cursor, 1);
		}
		weeks.push(row);
	}
	return weeks;
}

/**
 * Ordered weekday header labels for the chosen week start.
 *
 * `narrow` is the single letter the mini-month calendar prints, and it is deliberately ambiguous
 * (T/T, S/S) — the strip is a rhythm marker read positionally, not a set of words. The unabbreviated
 * name travels alongside it and is what the column header actually announces, so nothing is lost to
 * assistive technology by drawing one character.
 */
function weekdayHeaders(firstDayOfWeek: number): { narrow: string; long: string }[] {
	const out: { narrow: string; long: string }[] = [];
	for (let i = 0; i < 7; i++) {
		const idx = (firstDayOfWeek + i) % 7;
		const long = WEEKDAY_NAMES[idx];
		out.push({ narrow: long.slice(0, 1), long });
	}
	return out;
}

// #endregion

// #region Formatting

/*
 * The date pattern itself lives in `core/datetime.ts` — see `formatDatePattern`. It moved there when
 * DateTimePicker needed it: two implementations of one grammar is exactly how a picker and the
 * picker composing it come to disagree about what `mm/dd/yy` means.
 */

/** Append the time portion to a formatted date string. */
function formatTime(d: Date, hourFormat: "12" | "24"): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const s = `${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	if (hourFormat === "12") {
		const h = ((d.getHours() + 11) % 12) + 1;
		return `${pad(h)}:${s} ${d.getHours() < 12 ? "AM" : "PM"}`;
	}
	return `${pad(d.getHours())}:${s}`;
}

// #endregion

// #region Value normalization

/** Coerce any value shape into a flat list of dates. */
function toDates(v: DateValue): Date[] {
	if (v == null) return [];
	if (Array.isArray(v)) return v.filter((x): x is Date => x instanceof Date);
	return v instanceof Date ? [v] : [];
}

/** An empty per-segment buffer set. */
function emptyBuffers(): Record<DateSegmentKind, string> {
	return { day: "", month: "", year: "" };
}

// #endregion

/**
 * DatePicker — a token-only calendar adapted from PrimeNG's Calendar/DatePicker. Signal-first
 * (pass a `Signal` for controlled use). Supports single / multiple / range selection, an optional
 * time picker, N side-by-side months, min/max + disabled dates, an inline or popup presentation,
 * and a Today/Clear button bar.
 *
 * A single-date picker is typed into directly through three `DD`/`MM`/`YYYY` segments whose order
 * follows the caller's own `dateFormat`, and every keystroke moves the calendar with it. The rules
 * that decide what a keystroke means — when focus advances, what a two-digit year widens to, what
 * happens to the 31st when February is chosen — are pure functions in `core/date-segments.ts` and
 * are unit-tested there rather than being reachable only by dispatching events.
 *
 * KEYBOARD. The two halves of the control own the same four arrow keys with different meanings, and
 * which one answers is settled by which element holds focus rather than by a mode flag — so there is
 * no third state in which both believe they are active:
 *
 * | Key            | A segment has focus       | The grid has focus       |
 * | :------------- | :------------------------ | :----------------------- |
 * | Left / Right   | previous / next segment   | previous / next day      |
 * | Up / Down      | step this segment's value | previous / next week     |
 * | Enter          | open the calendar / close | select the focused day   |
 * | Space          | open the calendar         | select the focused day   |
 * | Backspace      | clear THIS segment only   | —                        |
 * | Tab            | ordinary focus traversal, in and out of the control       |
 *
 * In popup mode the PANEL is projected into `document.body` via {@link BodyPortal} and claims a live
 * stacking index from {@link useOverlayStack}, so it escapes any ancestor that would clip it
 * (`overflow: hidden`) or re-base its `position: fixed` (`transform`/`filter`/`backdrop-filter`) —
 * the trap a Dialog panel sets. The `inline` presentation is not portalled: it is ordinary in-flow
 * content, not an overlay.
 */
export function DatePicker(props: DatePickerProps): JSX.Element {
	const {
		value,
		onValueChange,
		selectionMode = "single",
		inline = false,
		showTime = false,
		hourFormat = "24",
		numberOfMonths = 1,
		minDate,
		maxDate,
		disabledDates,
		dateFormat = "mm/dd/yy",
		segmented = true,
		firstDayOfWeek = 1,
		yearSpan = 100,
		placeholder,
		showButtonBar = false,
		showIcon = false,
		dateTemplate,
		headerTemplate,
		footerTemplate,
		id,
		name,
		disabled,
		readOnly,
		required,
		status = "default",
		size = "md",
		fluid,
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": ariaDescribedby,
	} = props;

	const ctrl = useControllable<DateValue>(
		value,
		selectionMode === "single" ? null : [],
		onValueChange,
	);
	const rootId = useId(id, "datepicker");
	const panelId = `${rootId}-panel`;

	/** Three boxes can hold one date, so the other two cardinalities keep the read-only display. */
	const useSegments = segmented && selectionMode === "single";

	// #region Local UI state
	const seed = toDates(ctrl.get())[0] ?? new Date();
	const open = useRef(signal(false)).current;
	const viewDate = useRef(signal(startOfMonth(seed))).current;
	const focusedDate = useRef(signal(atMidnight(seed))).current;
	const timeH = useRef(signal(seed.getHours())).current;
	const timeM = useRef(signal(seed.getMinutes())).current;
	const timeS = useRef(signal(seed.getSeconds())).current;

	/**
	 * Which half of the control owns focus.
	 *
	 * Load-bearing, not bookkeeping: the roving-focus effect below moves focus onto the highlighted
	 * day whenever it changes, and typing a date changes it on every keystroke. Without an owner the
	 * grid would pull focus out of the segment mid-entry and the second digit would land nowhere.
	 */
	const focusOwner = useRef(signal<FocusOwner>(null)).current;

	/** The segmented input's working value, and the raw text of the segment being typed into. */
	const parts = useRef(signal<DateParts>(seedParts(ctrl.get()))).current;
	const buffers = useRef(signal(emptyBuffers())).current;
	const activeSegment = useRef(signal<DateSegmentKind | null>(null)).current;
	/** The segments name a whole date that `minDate`/`maxDate`/`disabledDates` refuse. */
	const outOfRange = useRef(signal(false)).current;

	const triggerRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	// #endregion

	// #region Overlay positioning + dismissal
	const stack = useOverlayStack({ active: open.value && !inline, layer: "popover" });
	const floating = useFloating({
		open: open.value && !inline,
		triggerRef: triggerRef as RefObject<HTMLElement>,
		panelRef: panelRef as RefObject<HTMLElement>,
		placement: "bottom-start",
		matchWidth: false,
	});
	useDismiss({
		open: open.value && !inline,
		onDismiss: () => (open.value = false),
		panelRef: panelRef as RefObject<HTMLElement>,
		triggerRef: triggerRef as RefObject<HTMLElement>,
		// The month/year pickers open their own panels FROM inside this one, so this overlay is not
		// always the top of the stack. `enabled` gates the ESCAPE channel only, and that channel is
		// exclusive (its handler calls `stopImmediatePropagation`), so exactly one overlay may own the
		// key: without this the calendar's listener registers first, wins the capture phase, and takes
		// the whole calendar down when the reader only meant to close the year list. Outside-pointer
		// dismissal is governed by containment instead and stays live regardless, so a child dropdown
		// can never leave the calendar stranded.
		enabled: stack.isTop,
	});

	// Move keyboard focus onto the active day whenever it (or the open state) changes — but only when
	// the GRID is what the reader is driving. While a segment holds focus the highlight still tracks
	// every keystroke; it just does not chase focus across the control to do it.
	useSignalEffect(() => {
		const key = dayKey(focusedDate.value);
		if (!(inline || open.value)) return;
		if (focusOwner.value !== "grid") return;
		const host = panelRef.current;
		if (!host) return;
		const el = host.querySelector<HTMLElement>(`[data-day="${key}"]`);
		el?.focus();
	});

	/**
	 * Adopt a value the caller changed from outside.
	 *
	 * Skipped while a segment holds focus: during entry the SEGMENTS are the truth and the bound value
	 * is downstream of them, so echoing it back would overwrite a half-typed date between two
	 * keystrokes. `peek` throughout, so writing `parts` here cannot re-trigger this effect.
	 */
	useSignalEffect(() => {
		const next = seedParts(ctrl.signal.value);
		if (!useSegments || activeSegment.peek() !== null) return;
		const cur = parts.peek();
		if (cur.day !== next.day || cur.month !== next.month || cur.year !== next.year) {
			parts.value = next;
		}
	});
	// #endregion

	// #region Header pickers
	/**
	 * `viewDate` remains the single source of truth for what the grid shows; these two mirrors exist
	 * only because `Select` binds a `Signal<string>`. Writing a mirror moves `viewDate`, moving
	 * `viewDate` (a chevron, a selection that lands in an adjacent month) re-publishes both, and a
	 * signal write of an equal string is a no-op — so the two directions settle instead of looping.
	 */
	const monthValue = useRef(signal(String(viewDate.peek().getMonth()))).current;
	const yearValue = useRef(signal(String(viewDate.peek().getFullYear()))).current;
	useSignalEffect(() => {
		const vd = viewDate.value;
		monthValue.value = String(vd.getMonth());
		yearValue.value = String(vd.getFullYear());
	});

	const viewYear = viewDate.value.getFullYear();
	// The year in view is always offered, so navigating past `yearSpan` (or past a min/max bound, which
	// the arrow keys can do) can never leave the picker showing its placeholder instead of the year the
	// grid is actually on.
	const thisYear = new Date().getFullYear();
	const minYear = Math.min(minDate ? minDate.getFullYear() : thisYear - yearSpan, viewYear);
	const maxYear = Math.max(maxDate ? maxDate.getFullYear() : thisYear + yearSpan, viewYear);
	const yearOptions = useMemo<Option[]>(() => {
		const out: Option[] = [];
		for (let y = minYear; y <= maxYear; y++) out.push({ value: String(y), label: String(y) });
		return out;
	}, [minYear, maxYear]);

	const pickMonth = (v: string) => {
		const m = Number(v);
		if (!Number.isInteger(m)) return;
		const vd = viewDate.peek();
		viewDate.value = new Date(vd.getFullYear(), m, 1);
	};
	const pickYear = (v: string) => {
		const y = Number(v);
		if (!Number.isInteger(y)) return;
		const vd = viewDate.peek();
		viewDate.value = new Date(y, vd.getMonth(), 1);
	};
	const stepMonths = (months: number) => {
		viewDate.value = addMonths(viewDate.peek(), months);
	};

	/**
	 * Would stepping by `months` put the whole view outside the selectable range?
	 *
	 * The year dropdown is already bounded by `minDate`/`maxDate`, so without this the chevrons could
	 * navigate to months the dropdown says do not exist — one control contradicting another about the
	 * same range. Only a step that leaves NO selectable day on screen is refused; a partly-bounded
	 * month is still worth showing, because its live days are exactly the edge of the window.
	 */
	const stepBlocked = (months: number): boolean => {
		if (disabled) return true;
		const target = monthIndex(addMonths(viewDate.value, months));
		const span = Math.max(1, numberOfMonths) - 1;
		if (minDate && target + span < monthIndex(minDate)) return true;
		if (maxDate && target > monthIndex(maxDate)) return true;
		return false;
	};
	// #endregion

	// #region Disabled predicate
	const isDisabledDate = (d: Date): boolean => {
		if (minDate && atMidnight(d) < atMidnight(minDate)) return true;
		if (maxDate && atMidnight(d) > atMidnight(maxDate)) return true;
		if (disabledDates?.some((x) => isSameDay(x, d))) return true;
		return false;
	};
	// #endregion

	// #region Selection state helpers
	const selected = toDates(ctrl.get());
	const rangeStart = selectionMode === "range" ? selected[0] : undefined;
	const rangeEnd = selectionMode === "range" ? selected[1] : undefined;

	const isSelected = (d: Date): boolean => {
		if (selectionMode === "range") return isSameDay(d, rangeStart) || isSameDay(d, rangeEnd);
		return selected.some((s) => isSameDay(s, d));
	};
	const isInRange = (d: Date): boolean => {
		if (selectionMode !== "range" || !rangeStart || !rangeEnd) return false;
		const t = atMidnight(d).getTime();
		return t > atMidnight(rangeStart).getTime() && t < atMidnight(rangeEnd).getTime();
	};
	// #endregion

	// #region Mutations
	/** Combine a calendar day with the current time-picker state. */
	const withTime = (d: Date): Date =>
		showTime
			? new Date(
				d.getFullYear(),
				d.getMonth(),
				d.getDate(),
				timeH.peek(),
				timeM.peek(),
				timeS.peek(),
			)
			: new Date(d.getFullYear(), d.getMonth(), d.getDate());

	const commitSingle = (d: Date) => {
		ctrl.set(withTime(d));
		if (useSegments) parts.value = partsFromDate(d);
		if (!inline && !showTime) open.value = false;
	};
	const commitMultiple = (d: Date) => {
		const exists = selected.some((s) => isSameDay(s, d));
		const next = exists ? selected.filter((s) => !isSameDay(s, d)) : [...selected, withTime(d)];
		ctrl.set(next);
	};
	const commitRange = (d: Date) => {
		const day = withTime(d);
		if (!rangeStart || (rangeStart && rangeEnd)) {
			ctrl.set([day]);
		} else if (atMidnight(day) < atMidnight(rangeStart)) {
			ctrl.set([day, rangeStart]);
		} else {
			ctrl.set([rangeStart, day]);
			if (!inline && !showTime) open.value = false;
		}
	};

	const selectDay = (d: Date) => {
		if (disabled || readOnly || isDisabledDate(d)) return;
		if (d.getMonth() !== viewDate.peek().getMonth()) viewDate.value = startOfMonth(d);
		focusOwner.value = "grid";
		focusedDate.value = atMidnight(d);
		if (selectionMode === "multiple") commitMultiple(d);
		else if (selectionMode === "range") commitRange(d);
		else commitSingle(d);
	};

	/** Re-apply edited time to the current single selection. */
	const applyTimeToSelection = () => {
		if (selectionMode === "single" && selected[0]) ctrl.set(withTime(selected[0]));
	};

	const clearValue = () => {
		ctrl.set(selectionMode === "single" ? null : []);
		if (useSegments) {
			parts.value = emptyParts();
			buffers.value = emptyBuffers();
			outOfRange.value = false;
		}
		if (!inline) open.value = false;
	};
	const selectToday = () => {
		const today = new Date();
		viewDate.value = startOfMonth(today);
		selectDay(today);
	};
	// #endregion

	// #region Segment editing
	/**
	 * Adopt an edit from the segmented input and move everything downstream of it.
	 *
	 * One write, three consequences, in a fixed order: the segments show it, the calendar travels to
	 * it, and the bound value takes it once there is a whole date to take. The middle one is what the
	 * brief asks for by "typing the month snaps the calendar to that month while keeping day 06
	 * selected" — the highlight follows a day the reader has typed even before the year exists, so
	 * `focusedDate` is moved from the parts and the view together rather than waiting for a complete
	 * date.
	 *
	 * An incomplete date does NOT clear the bound value. A reader who backspaces one segment and walks
	 * away has not asked for the field to be emptied, and the effect above puts the committed value
	 * back the moment focus leaves. Emptying every segment IS that request, and is honoured.
	 *
	 * A typed date the calendar would refuse — outside `minDate`/`maxDate`, or explicitly disabled —
	 * is NOT committed. The grid enforces those bounds by disabling cells, and a typing surface that
	 * quietly accepted what the grid refuses would make the same picker answer one question two ways.
	 * It is not clamped either, because rewriting `2099` to today's date under the reader's hands is a
	 * worse answer than showing them that 2099 is not available: the segments keep what was typed and
	 * mark themselves invalid, and the calendar travels there so the greyed-out month says why.
	 */
	const onSegmentEdit = (next: DateParts) => {
		parts.value = next;

		const view = viewDate.peek();
		const year = next.year ?? view.getFullYear();
		const month = next.month ?? view.getMonth();
		const target = new Date(year, month, 1);
		if (target.getTime() !== view.getTime()) viewDate.value = target;
		if (next.day !== null) {
			focusedDate.value = new Date(year, month, clampDayToMonth(year, month, next.day));
		}

		const date = partsToDate(next);
		if (date) {
			const refused = isDisabledDate(date);
			outOfRange.value = refused;
			if (!refused) ctrl.set(withTime(date));
			return;
		}
		outOfRange.value = false;
		if (next.day === null && next.month === null && next.year === null) ctrl.set(null);
	};

	const openPanel = (owner: FocusOwner) => {
		if (disabled || readOnly) return;
		focusOwner.value = owner;
		open.value = true;
	};
	// #endregion

	// #region Focus / navigation
	const setFocus = (d: Date) => {
		focusOwner.value = "grid";
		focusedDate.value = atMidnight(d);
		const fm = monthIndex(d);
		const vd = viewDate.peek();
		const vmStart = monthIndex(vd);
		if (fm < vmStart || fm > vmStart + numberOfMonths - 1) viewDate.value = startOfMonth(d);
	};

	const onGridKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const cur = focusedDate.peek();
		switch (e.key) {
			case "ArrowLeft":
				e.preventDefault();
				setFocus(addDays(cur, -1));
				break;
			case "ArrowRight":
				e.preventDefault();
				setFocus(addDays(cur, 1));
				break;
			case "ArrowUp":
				e.preventDefault();
				setFocus(addDays(cur, -7));
				break;
			case "ArrowDown":
				e.preventDefault();
				setFocus(addDays(cur, 7));
				break;
			case "Home":
				e.preventDefault();
				setFocus(addDays(cur, -((cur.getDay() - firstDayOfWeek + 7) % 7)));
				break;
			case "End":
				e.preventDefault();
				setFocus(addDays(cur, 6 - ((cur.getDay() - firstDayOfWeek + 7) % 7)));
				break;
			case "PageUp":
				e.preventDefault();
				setFocus(addMonths(cur, -1));
				break;
			case "PageDown":
				e.preventDefault();
				setFocus(addMonths(cur, 1));
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				selectDay(cur);
				break;
		}
	};
	// #endregion

	// #region Time change handlers
	const on24Hour = (e: JSX.TargetedEvent<HTMLSelectElement>) => {
		timeH.value = Number(e.currentTarget.value);
		applyTimeToSelection();
	};
	const on12Hour = (e: JSX.TargetedEvent<HTMLSelectElement>) => {
		const h12 = Number(e.currentTarget.value);
		const pm = timeH.peek() >= 12;
		timeH.value = (h12 % 12) + (pm ? 12 : 0);
		applyTimeToSelection();
	};
	const onMinute = (e: JSX.TargetedEvent<HTMLSelectElement>) => {
		timeM.value = Number(e.currentTarget.value);
		applyTimeToSelection();
	};
	const onSecond = (e: JSX.TargetedEvent<HTMLSelectElement>) => {
		timeS.value = Number(e.currentTarget.value);
		applyTimeToSelection();
	};
	const onMeridiem = (e: JSX.TargetedEvent<HTMLSelectElement>) => {
		const wantPm = e.currentTarget.value === "PM";
		const h = timeH.peek() % 12;
		timeH.value = wantPm ? h + 12 : h;
		applyTimeToSelection();
	};
	// #endregion

	// #region Renderers
	const headers = weekdayHeaders(firstDayOfWeek);

	/**
	 * One month grid.
	 *
	 * The whole-week hover band is CSS (`.ui-datepicker__week:hover`), not state. It was a signal read
	 * during render, which subscribed the component: crossing one day re-rendered 42 buttons and both
	 * header dropdowns, and — because `useDismiss` lists its `onDismiss` closure in a dependency array
	 * — tore down and re-added two `document` capture listeners on every cell. It was also wrong three
	 * ways that an ancestor `:hover` is right by construction: it never cleared on close, so the panel
	 * re-opened with a band lit under no pointer (`{gridIndex}:{row}` carries no month identity, so it
	 * always matched something); it went stale over the weekday strip and the row gap, which are
	 * inside the grid and so fire no `pointerleave` on it; and a DISABLED day dispatches no pointer
	 * events at all, which is most of the month in a date-of-birth picker bounded by `maxDate`.
	 */
	const renderGrid = (monthDate: Date, gridIndex: number): VNode => {
		const y = monthDate.getFullYear();
		const m = monthDate.getMonth();
		const weeks = monthMatrix(y, m, firstDayOfWeek);
		return (
			<div class="ui-datepicker__month" key={`${y}-${m}`}>
				<div class="ui-datepicker__month-title" aria-hidden="true">
					{`${MONTH_NAMES[m]} ${y}`}
				</div>
				<div
					class="ui-datepicker__grid"
					role="grid"
					aria-label={`${MONTH_NAMES[m]} ${y}`}
					onKeyDown={onGridKeyDown}
				>
					<div class="ui-datepicker__weekdays" role="row">
						{headers.map((h) => (
							<span
								class="ui-datepicker__weekday"
								role="columnheader"
								aria-label={h.long}
								key={h.long}
							>
								<span aria-hidden="true">{h.narrow}</span>
							</span>
						))}
					</div>
					{weeks.map((week, wi) => (
						<div class="ui-datepicker__week" role="row" key={`${gridIndex}-${wi}`}>
							{week.map((day) => {
								const inMonth = day.getMonth() === m;
								const dis = isDisabledDate(day);
								const sel = isSelected(day);
								const focused = isSameDay(day, focusedDate.value);
								const today = isSameDay(day, new Date());
								return (
									<button
										type="button"
										key={dayKey(day)}
										data-day={inMonth ? dayKey(day) : undefined}
										class={cx(
											"ui-datepicker__day",
											!inMonth && "ui-datepicker__day--outside",
											sel && "ui-datepicker__day--selected",
											isInRange(day) && "ui-datepicker__day--in-range",
											today && "ui-datepicker__day--today",
											dis && "ui-datepicker__day--disabled",
										)}
										role="gridcell"
										tabIndex={inMonth && focused ? 0 : -1}
										aria-selected={sel}
										aria-disabled={dis || undefined}
										aria-current={today ? "date" : undefined}
										aria-label={`${WEEKDAY_NAMES[day.getDay()]}, ${
											MONTH_NAMES[day.getMonth()]
										} ${day.getDate()}, ${day.getFullYear()}`}
										disabled={dis}
										onClick={() => selectDay(day)}
									>
										{dateTemplate ? dateTemplate(day) : day.getDate()}
									</button>
								);
							})}
						</div>
					))}
				</div>
			</div>
		);
	};

	const renderHeaderNav = (): VNode => (
		<CalendarHeader
			monthValue={monthValue}
			yearValue={yearValue}
			yearOptions={yearOptions}
			onPickMonth={pickMonth}
			onPickYear={pickYear}
			onStep={stepMonths}
			stepBlocked={stepBlocked}
			compact={numberOfMonths !== 1}
		/>
	);

	const renderTime = (): VNode => {
		const pad = (n: number) => String(n).padStart(2, "0");
		const hours: number[] = [];
		const hourCount = hourFormat === "12" ? 12 : 24;
		for (let i = 0; i < hourCount; i++) hours.push(hourFormat === "12" ? i + 1 : i);
		const minutes = Array.from({ length: 60 }, (_, i) => i);
		const cur12 = ((timeH.value + 11) % 12) + 1;
		return (
			<div class="ui-datepicker__time" role="group" aria-label="Time">
				<select
					class="ui-datepicker__select"
					aria-label="Hour"
					value={hourFormat === "12" ? cur12 : timeH.value}
					onChange={hourFormat === "12" ? on12Hour : on24Hour}
				>
					{hours.map((h) => <option value={h} key={`h${h}`}>{pad(h)}</option>)}
				</select>
				<span class="ui-datepicker__time-sep" aria-hidden="true">:</span>
				<select
					class="ui-datepicker__select"
					aria-label="Minute"
					value={timeM.value}
					onChange={onMinute}
				>
					{minutes.map((mm) => <option value={mm} key={`m${mm}`}>{pad(mm)}</option>)}
				</select>
				<span class="ui-datepicker__time-sep" aria-hidden="true">:</span>
				<select
					class="ui-datepicker__select"
					aria-label="Second"
					value={timeS.value}
					onChange={onSecond}
				>
					{minutes.map((ss) => <option value={ss} key={`s${ss}`}>{pad(ss)}</option>)}
				</select>
				{hourFormat === "12" && (
					<select
						class="ui-datepicker__select"
						aria-label="AM/PM"
						value={timeH.value < 12 ? "AM" : "PM"}
						onChange={onMeridiem}
					>
						<option value="AM">AM</option>
						<option value="PM">PM</option>
					</select>
				)}
			</div>
		);
	};

	/**
	 * The month area.
	 *
	 * One month gets the swipeable strip; several keep the plain side-by-side layout, because a
	 * gesture that moves a two-month view by one month leaves the reader looking at a page they were
	 * already half looking at, and a strip of pages three months wide does not fit a popover.
	 */
	const renderMonths = (): VNode => {
		if (numberOfMonths === 1) {
			return (
				<CalendarMonthTrack
					viewDate={viewDate.value}
					renderMonth={(monthDate) => renderGrid(monthDate, 0)}
					onStep={stepMonths}
					stepBlocked={stepBlocked}
				/>
			);
		}
		const months: VNode[] = [];
		for (let i = 0; i < Math.max(1, numberOfMonths); i++) {
			months.push(renderGrid(addMonths(viewDate.value, i), i));
		}
		return <div class="ui-datepicker__months">{months}</div>;
	};

	const renderPanelBody = (): VNode => (
		<>
			{headerTemplate}
			{renderHeaderNav()}
			{renderMonths()}
			{showTime && renderTime()}
			{footerTemplate}
			{showButtonBar && (
				<div class="ui-datepicker__buttonbar">
					<button type="button" class="ui-datepicker__bar-btn" onClick={selectToday}>
						Today
					</button>
					<button type="button" class="ui-datepicker__bar-btn" onClick={clearValue}>Clear</button>
				</div>
			)}
		</>
	);

	const displayValue = (): string => {
		const dates = toDates(ctrl.signal.value);
		if (dates.length === 0) return "";
		const fmt = (d: Date) =>
			formatDatePattern(d, dateFormat) + (showTime ? ` ${formatTime(d, hourFormat)}` : "");
		if (selectionMode === "range") {
			return dates.length === 2 ? `${fmt(dates[0])} - ${fmt(dates[1])}` : fmt(dates[0]);
		}
		return dates.map(fmt).join(", ");
	};
	// #endregion

	// #region Inline presentation
	if (inline) {
		return (
			<div
				class={cx(
					"ui-datepicker",
					"ui-datepicker--inline",
					disabled && "ui-datepicker--disabled",
					className,
				)}
				ref={panelRef}
				aria-label={ariaLabel}
				aria-describedby={ariaDescribedby}
			>
				{renderPanelBody()}
			</div>
		);
	}
	// #endregion

	// #region Popup presentation
	const toggleOpen = () => {
		if (disabled || readOnly) return;
		if (open.value) open.value = false;
		else openPanel("grid");
	};

	const layout = parseSegmentLayout(dateFormat);

	return (
		<div class={cx("ui-datepicker", fluid && "ui-datepicker--fluid", className)}>
			<div
				ref={triggerRef}
				class={cx(
					"ui-field",
					"ui-datepicker__trigger",
					useSegments && "ui-datepicker__trigger--segmented",
					...fieldModifiers("ui-field", {
						size,
						status,
						fluid,
						disabled,
						readOnly,
						open: open.value,
						focused: useSegments && activeSegment.value !== null,
					}),
				)}
			>
				{useSegments
					? (
						<DateSegmentedInput
							layout={layout}
							parts={parts.value}
							buffers={buffers.value}
							open={open.value}
							panelId={panelId}
							inputId={rootId}
							disabled={disabled}
							readOnly={readOnly}
							required={required}
							outOfRange={outOfRange.value}
							aria-label={ariaLabel}
							aria-describedby={ariaDescribedby}
							aria-invalid={ariaInvalid(status)}
							onEdit={onSegmentEdit}
							onBuffer={(kind, buffer) => {
								buffers.value = { ...buffers.peek(), [kind]: buffer };
							}}
							onActivate={(kind) => {
								activeSegment.value = kind;
								if (kind !== null) focusOwner.value = "segments";
								else if (focusOwner.peek() === "segments") focusOwner.value = null;
							}}
							// A click keeps focus where it is so typing continues; Enter hands the calendar
							// focus, which is what makes the second Enter select a day.
							onRequestOpen={openPanel}
							onRequestClose={() => (open.value = false)}
						/>
					)
					: (
						<input
							id={rootId}
							type="text"
							class="ui-field__input ui-datepicker__entry"
							readOnly
							disabled={disabled}
							required={required}
							placeholder={placeholder}
							value={displayValue()}
							role="combobox"
							aria-haspopup="grid"
							aria-expanded={open.value}
							aria-controls={panelId}
							aria-label={ariaLabel}
							aria-describedby={ariaDescribedby}
							aria-invalid={ariaInvalid(status)}
							aria-required={required || undefined}
							onClick={toggleOpen}
							onKeyDown={(e) => {
								if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									openPanel("grid");
								}
							}}
						/>
					)}
				{showIcon && (
					<button
						type="button"
						class="ui-datepicker__icon"
						aria-label="Open calendar"
						aria-expanded={open.value}
						disabled={disabled}
						tabIndex={-1}
						onClick={toggleOpen}
					>
						<Icon name="calendar" />
					</button>
				)}
			</div>

			{
				/* The wire form is a hidden field, so the visible control stays free to print whatever
				   `dateFormat` asks for without a form receiving a string it cannot parse. Single mode
				   only: there is no agreed wire shape for a set of dates or a range. */
			}
			{name !== undefined && selectionMode === "single" && (
				<input
					type="hidden"
					name={name}
					value={selected[0] ? toLocalIsoDate(selected[0]) : ""}
				/>
			)}

			{open.value && (
				<BodyPortal>
					<div
						id={panelId}
						ref={panelRef}
						class="ui-datepicker__panel"
						role="dialog"
						aria-modal="false"
						aria-label={ariaLabel ?? "Choose date"}
						style={styleVars({
							"--float-top": floating ? `${floating.top}px` : undefined,
							"--float-left": floating ? `${floating.left}px` : undefined,
							// The panel caps itself to the space measured on the side it resolved to and
							// scrolls internally, rather than letting a tall calendar (multi-month, or a time
							// picker under it) run off the bottom of a short viewport. `null` means that side
							// is deliberately unbounded, which is not a length — emit nothing and let the
							// sheet's own absolute cap stand.
							"--float-available-h": floating?.availableHeight != null
								? `${floating.availableHeight}px`
								: undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						{renderPanelBody()}
					</div>
				</BodyPortal>
			)}
		</div>
	);
	// #endregion
}

// #region Seeding

/** The segment values a bound value implies. A set, a range or nothing all seed empty. */
function seedParts(v: DateValue): DateParts {
	const first = toDates(v)[0];
	return first ? partsFromDate(first) : emptyParts();
}

// #endregion
