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
import { formatDatePattern } from "../core/datetime.ts";
import type { BaseFieldProps, Bindable, Option, ValueChange } from "../types/mod.ts";
import { Icon } from "../../icons/mod.ts";
import { Select } from "./Select.tsx";

// #region Types

/** Selection cardinality. `single` → one date, `multiple` → a set, `range` → `[start, end]`. */
export type DateSelectionMode = "single" | "multiple" | "range";

/** The bound value shape: a single date (or null), or an array (multiple / range). */
export type DateValue = Date | Date[] | null;

/** Custom day-cell renderer — receives the cell's date, returns the inner content. */
export type DateTemplate = (date: Date) => VNode | string;

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
	/** Display format tokens: `d dd m mm yy yyyy` (default `mm/dd/yy`). */
	dateFormat?: string;
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
	/** Input placeholder (popup mode). */
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

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
const WEEKDAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

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

// #region Header picker constants

/** Month options for the header picker — built once; the labels never change. */
const MONTH_OPTIONS: Option[] = MONTH_NAMES.map((label, i) => ({ value: String(i), label }));

/**
 * Row height for the two windowed header lists, px.
 *
 * The windowed renderer positions rows absolutely, so it needs a concrete number where the rest of
 * the taxonomy reads a token. This is `Select`'s own `virtualItemSize` default — stated rather than
 * inherited, so a change to that default cannot silently misalign a two-hundred-entry list.
 *
 * BOTH header lists are windowed on it, including the twelve-row month list that does not need the
 * windowing, because the alternative is two adjacent dropdowns with different row heights: an
 * unwindowed `.ui-select__option` is `max(--fld-opt-h, line-box + 2 × --space-2)`, which at the
 * default root size resolves to ~38.5px rather than the token's 36px — and, being a function of the
 * root font size, to a different number again at any other. No px constant can equal that, so the
 * two lists are made to agree with each OTHER instead of each disagreeing separately. The real fix
 * is for `Select` to measure its own row; this constant goes when it does.
 */
const NAV_ROW_H = 40;

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

// #endregion

/**
 * DatePicker — a token-only calendar adapted from PrimeNG's Calendar/DatePicker. Signal-first
 * (pass a `Signal` for controlled use). Supports single / multiple / range selection, an optional
 * time picker, N side-by-side months, min/max + disabled dates, an inline or popup presentation,
 * and a Today/Clear button bar. The grid is a full ARIA `grid` with roving-focus keyboard control
 * (arrows move ±1 day / ±7 days, PageUp/Down change month, Home/End hit week edges, Enter/Space
 * selects). Composes the shared `.ui-field` geometry for the popup trigger.
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

	// #region Local UI state
	const seed = toDates(ctrl.get())[0] ?? new Date();
	const open = useRef(signal(false)).current;
	const viewDate = useRef(signal(startOfMonth(seed))).current;
	const focusedDate = useRef(signal(atMidnight(seed))).current;
	const timeH = useRef(signal(seed.getHours())).current;
	const timeM = useRef(signal(seed.getMinutes())).current;
	const timeS = useRef(signal(seed.getSeconds())).current;

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

	// Move keyboard focus onto the active day whenever it (or the open state) changes.
	useSignalEffect(() => {
		const key = dayKey(focusedDate.value);
		if (!(inline || open.value)) return;
		const host = panelRef.current;
		if (!host) return;
		const el = host.querySelector<HTMLElement>(`[data-day="${key}"]`);
		el?.focus();
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
		if (!inline) open.value = false;
	};
	const selectToday = () => {
		const today = new Date();
		viewDate.value = startOfMonth(today);
		selectDay(today);
	};
	// #endregion

	// #region Focus / navigation
	const setFocus = (d: Date) => {
		focusedDate.value = atMidnight(d);
		const fm = d.getFullYear() * 12 + d.getMonth();
		const vd = viewDate.peek();
		const vmStart = vd.getFullYear() * 12 + vd.getMonth();
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

	/**
	 * The month header, laid out the way the mini-month calendar is: the period on the leading side,
	 * the two step buttons grouped together on the trailing side.
	 *
	 * The month and year controls are the package's own {@link Select}, not native `<select>`s. A
	 * native dropdown is drawn by the OS: it ignores the token layer, cannot be windowed, and — the
	 * reason it had to go — renders a century of years as a single unbounded list. Because both open
	 * from a trigger that lives INSIDE this (already portalled) panel, the overlay registry reads them
	 * as this overlay's children, so choosing a month is not an outside click on the calendar.
	 */
	const renderHeaderNav = (): VNode => (
		<div class="ui-datepicker__nav">
			{numberOfMonths === 1
				? (
					<div class="ui-datepicker__nav-selects">
						<Select
							class="ui-field--bare ui-datepicker__nav-select"
							size="sm"
							aria-label="Month"
							options={MONTH_OPTIONS}
							value={monthValue}
							virtualScroll
							virtualItemSize={NAV_ROW_H}
							onValueChange={pickMonth}
						/>
						<Select
							class="ui-field--bare ui-datepicker__nav-select"
							size="sm"
							aria-label="Year"
							options={yearOptions}
							value={yearValue}
							virtualScroll
							virtualItemSize={NAV_ROW_H}
							onValueChange={pickYear}
						/>
					</div>
				)
				: <div class="ui-datepicker__nav-spacer" />}
			<div class="ui-datepicker__nav-btns">
				<button
					type="button"
					class="ui-datepicker__nav-btn"
					aria-label="Previous month"
					onClick={() => (viewDate.value = addMonths(viewDate.peek(), -1))}
				>
					<Icon name="chevron-left" />
				</button>
				<button
					type="button"
					class="ui-datepicker__nav-btn"
					aria-label="Next month"
					onClick={() => (viewDate.value = addMonths(viewDate.peek(), 1))}
				>
					<Icon name="chevron-right" />
				</button>
			</div>
		</div>
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

	const renderPanelBody = (): VNode => {
		const months: VNode[] = [];
		for (let i = 0; i < Math.max(1, numberOfMonths); i++) {
			months.push(renderGrid(addMonths(viewDate.value, i), i));
		}
		return (
			<>
				{headerTemplate}
				{renderHeaderNav()}
				<div class="ui-datepicker__months">{months}</div>
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
	};

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
		open.value = !open.value;
	};

	return (
		<div class={cx("ui-datepicker", fluid && "ui-datepicker--fluid", className)}>
			<div
				ref={triggerRef}
				class={cx(
					"ui-field",
					"ui-datepicker__trigger",
					...fieldModifiers("ui-field", {
						size,
						status,
						fluid,
						disabled,
						readOnly,
						open: open.value,
					}),
				)}
			>
				<input
					id={rootId}
					name={name}
					type="text"
					class="ui-field__input"
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
							open.value = true;
						}
					}}
				/>
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
