import type { JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import { signal, useSignalEffect } from "@preact/signals";
import "../styles/datetime-picker.css";
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
	dayTimeBounds,
	formatDatePattern,
	formatTimeOfDay,
	minutesOfDay,
	startOfDay,
	toLocalIsoMinute,
	withMinutes,
} from "../core/datetime.ts";
import { DEFAULT_MINUTE_STEP, resolveMinutes } from "../core/tumbler.ts";
import type { BaseFieldProps, Bindable, OverlayFieldProps, ValueChange } from "../types/mod.ts";
import { Icon } from "../../icons/mod.ts";
import { DatePicker, type DateValue } from "./DatePicker.tsx";
import { TimeTumbler } from "./TimeTumbler.tsx";

// #region Props

/** Props for {@link DateTimePicker}. */
export interface DateTimePickerProps extends BaseFieldProps, OverlayFieldProps {
	/** Bound value — one `Date` carrying BOTH the day and the time, or `null`. Raw or `Signal`. */
	value?: Bindable<Date | null>;
	/** Fired whenever the committed date-time changes. */
	onValueChange?: ValueChange<Date | null>;
	/**
	 * Earliest selectable instant, inclusive.
	 *
	 * Constrains the TIME as well as the day: on the boundary day the tumbler offers only the hours
	 * and minutes that fall inside the bound. A picker that accepts a legal date and then an illegal
	 * hour on it is worse than one that refuses both, because the refusal arrives after the reader has
	 * already committed.
	 */
	min?: Date;
	/** Latest selectable instant, inclusive. Constrains the time on the boundary day. */
	max?: Date;
	/** 12-hour clock with an AM/PM column (default `false`). */
	hour12?: boolean;
	/** Minute granularity for the tumbler (default `5` — see {@link TimeTumbler}). */
	minuteStep?: number;
	/** Explicit list of non-selectable days. */
	disabledDates?: Date[];
	/** Date portion of the display format: `d dd m mm yy yyyy` (default `mm/dd/yy`). */
	dateFormat?: string;
	/** First day of the week: `0` Sun … `1` Mon (default `1`). */
	firstDayOfWeek?: 0 | 1;
	/** How many years the year picker offers either side of the current year (default `100`). */
	yearSpan?: number;
	/** Input placeholder. */
	placeholder?: string;
	/** Show a calendar icon trigger inside the input. */
	showIcon?: boolean;
	/** Add "Now" and "Clear" beside the panel's Done button. */
	showButtonBar?: boolean;
	class?: string;
}

// #endregion

// #region Helpers

/** Pull an instant inside the `[min, max]` window, if either end is given. */
function clampInstant(d: Date, min?: Date, max?: Date): Date {
	if (min && d.getTime() < min.getTime()) return min;
	if (max && d.getTime() > max.getTime()) return max;
	return d;
}

// #endregion

/**
 * DateTimePicker — ONE popover holding the calendar and a drum-roll time tumbler, returning a single
 * `Date` that carries both.
 *
 * It **composes** {@link DatePicker} in its `inline` presentation rather than reimplementing a grid:
 * the month matrix, the roving-focus keyboard model, the windowed month/year dropdowns and the
 * min/max/disabled-day predicate are all that component's, already built and already tested. Only
 * the chrome is suppressed — an inline DatePicker draws its own bordered card, and a card inside a
 * panel is a box in a box (§B.4).
 *
 * **The date and the time are bound together, not merely displayed together.** Choosing a day
 * re-resolves the time against THAT day's window ({@link dayTimeBounds}), so moving to the boundary
 * day of a `min`/`max` narrows the tumbler's reels instead of leaving an hour selected that the
 * caller declared illegal. Editing the time when nothing is selected commits the day the panel
 * opened on — a time with no date is not a value, and silently discarding the reader's input is the
 * one outcome worse than picking a day for them.
 *
 * The PANEL is projected into `document.body` via {@link BodyPortal} and claims a live stacking index
 * from {@link useOverlayStack}, so it escapes any ancestor that would clip it (`overflow: hidden`) or
 * re-base its `position: fixed` (`transform` / `filter` / `backdrop-filter`) — the trap a Dialog
 * panel and the app's glass chrome both set.
 */
export function DateTimePicker(props: DateTimePickerProps): JSX.Element {
	const {
		value,
		onValueChange,
		min,
		max,
		hour12 = false,
		minuteStep = DEFAULT_MINUTE_STEP,
		disabledDates,
		dateFormat = "mm/dd/yy",
		firstDayOfWeek = 1,
		yearSpan = 100,
		placeholder,
		showIcon = false,
		showButtonBar = false,
		avoid,
		allowOverflow,
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

	const ctrl = useControllable<Date | null>(value, null, onValueChange);
	const rootId = useId(id, "datetime");
	const panelId = `${rootId}-panel`;

	// #region Local state
	const open = useRef(signal(false)).current;

	/**
	 * The day and the minute the panel is currently working on.
	 *
	 * They exist because the two halves of the panel are edited independently and either may be
	 * touched first. With nothing committed yet, the tumbler still has to show and move a real time,
	 * and the calendar still has to combine a chosen day with whatever the tumbler is showing.
	 */
	const draftDay = useRef(signal(startOfDay(new Date()))).current;
	const draftMinutes = useRef(signal(0)).current;

	/** The signal handed to the composed calendar. Mirrors `ctrl`; see the effect below. */
	const calValue = useRef(signal<DateValue>(null)).current;

	const triggerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	// #endregion

	/**
	 * Keep the calendar's signal and the draft time in step with the bound value.
	 *
	 * One direction only. The composed DatePicker fires `onValueChange` from its own selection
	 * handler, never from an external write to its signal, so mirroring downward here cannot feed
	 * back — the two settle instead of looping.
	 */
	useSignalEffect(() => {
		const cur = ctrl.signal.value;
		calValue.value = cur;
		if (cur) {
			draftDay.value = startOfDay(cur);
			draftMinutes.value = minutesOfDay(cur);
		}
	});

	// #region Overlay positioning + dismissal
	const stack = useOverlayStack({ active: open.value, layer: "popover" });
	const floating = useFloating({
		open: open.value,
		triggerRef: triggerRef as RefObject<HTMLElement>,
		panelRef: panelRef as RefObject<HTMLElement>,
		placement: "bottom-start",
		matchWidth: false,
		avoid,
		allowOverflow,
	});

	/**
	 * Close, and return focus to the trigger only when it would otherwise be lost.
	 *
	 * `useDismiss` cannot say WHY it fired. Restoring unconditionally steals focus from whatever an
	 * outside click just landed on; never restoring drops focus to `<body>` when Escape removes the
	 * panel the reader was standing in. Asking where focus currently is answers both: inside the
	 * panel it is about to be destroyed, so bring it back; anywhere else it belongs to someone.
	 */
	const close = () => {
		const active = typeof document === "undefined" ? null : document.activeElement;
		const inside = !!active && !!panelRef.current && panelRef.current.contains(active);
		open.value = false;
		if (inside) inputRef.current?.focus();
	};

	/**
	 * A stable handle on the latest `close`, for `useDismiss`.
	 *
	 * That hook lists `onDismiss` in a dependency array, so a fresh closure each render tears down and
	 * re-adds two `document` capture listeners on every render — and this component re-renders on every
	 * cell the tumbler crosses, which during a drag is once a frame. Routing through a ref keeps the
	 * callback current while the identity the effect keys on never changes.
	 */
	const closeRef = useRef(close);
	closeRef.current = close;
	const dismiss = useRef(() => closeRef.current()).current;

	useDismiss({
		open: open.value,
		onDismiss: dismiss,
		panelRef: panelRef as RefObject<HTMLElement>,
		triggerRef: triggerRef as RefObject<HTMLElement>,
		// The calendar's month/year dropdowns open their own panels from INSIDE this one, so this
		// overlay is not always the top of the stack. `enabled` gates the exclusive Escape channel only;
		// outside-pointer dismissal is governed by containment and stays live, so a child dropdown can
		// never leave the picker stranded.
		enabled: stack.isTop,
	});
	// #endregion

	// #region Value plumbing
	/** The day every bound below is measured against — the committed one, else the panel's draft. */
	const activeDay = ctrl.signal.value ?? draftDay.value;
	const bounds = dayTimeBounds(activeDay, min, max);

	const commit = (next: Date | null) => {
		if (disabled || readOnly) return;
		ctrl.set(next);
	};

	/**
	 * A day arrived from the calendar.
	 *
	 * The composed DatePicker strips the time (it runs with `showTime` off, so it commits midnight),
	 * which is exactly what is wanted: the day is ITS decision, the clock is the tumbler's, and this
	 * is the one place they are put back together — after re-resolving the time against the new day's
	 * window, because the window may just have narrowed under it.
	 */
	const onCalendarChange = (v: DateValue) => {
		const day = Array.isArray(v) ? v[0] : v;
		if (!day) {
			commit(null);
			return;
		}
		const dayBounds = dayTimeBounds(day, min, max);
		const minutes = resolveMinutes(
			draftMinutes.peek(),
			minuteStep,
			dayBounds.lo,
			dayBounds.hi,
			hour12,
		);
		draftDay.value = startOfDay(day);
		draftMinutes.value = minutes;
		commit(withMinutes(day, minutes));
	};

	/**
	 * A time arrived from the tumbler.
	 *
	 * With nothing committed the draft day is used, so spinning the drum produces a real value rather
	 * than nothing at all. That is a choice worth stating: the alternative — refusing to commit until
	 * a day is also clicked — silently discards the only interaction the reader has performed.
	 */
	const onTimeChange = (minutes: number) => {
		draftMinutes.value = minutes;
		const cur = ctrl.get();
		commit(withMinutes(cur ?? draftDay.peek(), minutes));
	};
	// #endregion

	// #region Panel open / close
	const openPanel = () => {
		if (disabled || readOnly) return;
		// Seed synchronously, and seed with an ALREADY-RESOLVED time. A raw `new Date()` is almost never
		// on the minute grid, and the tumbler normalises what it is given — which would fire a change
		// and commit a value the reader never asked for, just for opening the panel.
		const cur = ctrl.get();
		const seed = cur ?? clampInstant(new Date(), min, max);
		const day = startOfDay(seed);
		const seedBounds = dayTimeBounds(day, min, max);
		draftDay.value = day;
		draftMinutes.value = resolveMinutes(
			minutesOfDay(seed),
			minuteStep,
			seedBounds.lo,
			seedBounds.hi,
			hour12,
		);
		open.value = true;
	};
	const toggleOpen = () => (open.value ? close() : openPanel());

	const pickNow = () => {
		const now = clampInstant(new Date(), min, max);
		const day = startOfDay(now);
		const b = dayTimeBounds(day, min, max);
		const minutes = resolveMinutes(minutesOfDay(now), minuteStep, b.lo, b.hi, hour12);
		draftDay.value = day;
		draftMinutes.value = minutes;
		commit(withMinutes(day, minutes));
	};

	const clearValue = () => {
		commit(null);
		close();
	};
	// #endregion

	// #region Display
	const selected = ctrl.signal.value;
	const displayValue = selected
		? `${formatDatePattern(selected, dateFormat)} ${
			formatTimeOfDay(minutesOfDay(selected), hour12)
		}`
		: "";
	// #endregion

	return (
		<div class={cx("ui-datetime", fluid && "ui-datetime--fluid", className)}>
			<div
				ref={triggerRef}
				class={cx(
					"ui-field",
					"ui-datetime__trigger",
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
					ref={inputRef}
					id={rootId}
					type="text"
					class="ui-field__input"
					readOnly
					disabled={disabled}
					required={required}
					placeholder={placeholder}
					value={displayValue}
					role="combobox"
					aria-haspopup="dialog"
					aria-expanded={open.value ? "true" : "false"}
					aria-controls={panelId}
					aria-label={ariaLabel}
					aria-describedby={ariaDescribedby}
					aria-invalid={ariaInvalid(status)}
					aria-required={required || undefined}
					onClick={toggleOpen}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							openPanel();
						}
					}}
				/>
				{showIcon && (
					<button
						type="button"
						class="ui-datetime__icon"
						aria-label="Choose date and time"
						aria-expanded={open.value ? "true" : "false"}
						disabled={disabled}
						tabIndex={-1}
						onClick={toggleOpen}
					>
						<Icon name="calendar" />
					</button>
				)}
			</div>
			{
				/* The wire form is a hidden field, so the visible input stays free to print whatever
			    `dateFormat` asks for without a form receiving a localised string it cannot parse. */
			}
			{name !== undefined && (
				<input type="hidden" name={name} value={selected ? toLocalIsoMinute(selected) : ""} />
			)}

			{open.value && (
				<BodyPortal>
					<div
						id={panelId}
						ref={panelRef}
						class="ui-datetime__panel"
						role="dialog"
						aria-modal="false"
						aria-label={ariaLabel ?? "Choose date and time"}
						style={styleVars({
							"--float-top": floating ? `${floating.top}px` : undefined,
							"--float-left": floating ? `${floating.left}px` : undefined,
							// Cap to the space measured on the side the positioner resolved to and scroll
							// internally, rather than letting a calendar with a tumbler beside it run off the
							// bottom of a short viewport. `null` means that side is deliberately unbounded,
							// which is not a length — emit nothing and let the sheet's own cap stand.
							"--float-available-h": floating?.availableHeight != null
								? `${floating.availableHeight}px`
								: undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						<div class="ui-datetime__body">
							<DatePicker
								inline
								class="ui-datetime__calendar"
								value={calValue}
								onValueChange={onCalendarChange}
								selectionMode="single"
								minDate={min}
								maxDate={max}
								disabledDates={disabledDates}
								firstDayOfWeek={firstDayOfWeek}
								yearSpan={yearSpan}
								disabled={disabled}
								readOnly={readOnly}
								aria-label="Date"
							/>

							<div class="ui-datetime__time">
								{
									/*
									 * `aria-hidden` on purpose: the tumbler's own `role="group"` is already named
									 * "Time", and a visible caption that also announced would read the same word
									 * twice for no added fact. It stays for the eye, which has no group label.
									 */
								}
								<span class="ui-datetime__time-caption" aria-hidden="true">
									Time
								</span>
								<TimeTumbler
									value={draftMinutes}
									onValueChange={onTimeChange}
									hour12={hour12}
									minuteStep={minuteStep}
									minMinutes={bounds.lo}
									maxMinutes={bounds.hi}
									size={size}
									status={status}
									disabled={disabled}
									readOnly={readOnly}
									aria-label="Time"
								/>
							</div>
						</div>

						<div class="ui-datetime__foot">
							<div class="ui-datetime__foot-start">
								{showButtonBar && (
									<>
										<button
											type="button"
											class="ui-datetime__bar-btn"
											disabled={disabled || readOnly}
											onClick={pickNow}
										>
											Now
										</button>
										<button
											type="button"
											class="ui-datetime__bar-btn"
											disabled={disabled || readOnly}
											onClick={clearValue}
										>
											Clear
										</button>
									</>
								)}
							</div>
							{
								/*
								 * Done is not optional chrome. Picking a day does NOT close this panel — the time is
								 * still unset — so without a visible commit-and-leave control the only exits are
								 * Escape and clicking away, neither of which a reader is told about.
								 */
							}
							<button
								type="button"
								class="ui-datetime__bar-btn ui-datetime__bar-btn--primary"
								onClick={close}
							>
								Done
							</button>
						</div>
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
