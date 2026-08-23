import type { JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/time-tumbler.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { ariaInvalid } from "../core/field.ts";
import { clampToRange, MINUTES_PER_DAY } from "../core/datetime.ts";
import {
	DEFAULT_MINUTE_STEP,
	DRAG_THRESHOLD_PX,
	dragResidual,
	dragSteps,
	flickSteps,
	hourItems,
	type Meridiem,
	meridiemItems,
	minuteItems,
	nearestIndex,
	quarterTurn,
	resolveMinutes,
	resolveTyped,
	type TumblerItem,
	wheelDeltaPx,
	wrapIndex,
} from "../core/tumbler.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props

/** Props for {@link TimeTumbler}. */
export interface TimeTumblerProps extends Omit<BaseFieldProps, "fluid"> {
	/**
	 * Bound value — MINUTES SINCE LOCAL MIDNIGHT (0–1439). Raw (uncontrolled) or a `Signal`
	 * (controlled).
	 *
	 * A minute count rather than a `Date` on purpose: a time of day is not an instant, and binding
	 * one to a `Date` forces every consumer to carry a calendar day it does not have and to answer
	 * DST questions it cannot. {@link DateTimePicker} is the component that owns a day, and it is the
	 * one that converts.
	 */
	value?: Bindable<number>;
	/** Fired whenever the committed time changes. */
	onValueChange?: ValueChange<number>;
	/** Render a 12-hour clock with an AM/PM column. The bound value stays minutes past midnight. */
	hour12?: boolean;
	/**
	 * Minute granularity (default `5`).
	 *
	 * Five, not one, because a drum is a *coarse* instrument: a 60-cell minute reel puts every value
	 * behind a long drag or a held arrow key, and every scheduling surface this control was built for
	 * — sessions, discovery calls, stage deadlines — is expressed in five-minute grains. A caller who
	 * genuinely needs the minute passes `minuteStep={1}`, and typing into the centre cell reaches any
	 * offered value at any step. A `min`/`max` that does not sit on the grid is still offered, so a
	 * coarse step can never make the earliest legal time unreachable.
	 */
	minuteStep?: number;
	/** Earliest selectable minute of the day, inclusive (default `0`). */
	minMinutes?: number;
	/** Latest selectable minute of the day, inclusive (default `1439`). */
	maxMinutes?: number;
	class?: string;
}

// #endregion

// #region Reel geometry

/**
 * How many cells are rendered either side of the selected one.
 *
 * Two, while only three are visible. The extra row on each side is what a mid-drag translate of up
 * to half a cell reveals; rendering only the immediate neighbours would open a gap at the top or
 * bottom of the viewport on every gesture.
 */
const REEL_RADIUS = 2;

/** The offsets a reel renders, top to bottom: earlier values above the selected one, later below. */
const REEL_OFFSETS = Array.from({ length: REEL_RADIUS * 2 + 1 }, (_, i) => i - REEL_RADIUS);

/**
 * How stale the last movement sample may be, in ms, and still count as a throw.
 *
 * Roughly four frames at 60Hz: long enough that an ordinary fast release still flicks, short enough
 * that a deliberate pause before lifting does not. Without the check a stationary pointer keeps
 * whatever velocity it last had, so settling on a value and then letting go threw the reel past it.
 */
const FLICK_STALE_MS = 64;

// #endregion

// #region One column

interface TumblerColumnProps {
	id: string;
	/** Accessible name — "Hours", "Minutes", "AM/PM". */
	label: string;
	/**
	 * Accessible names for the ▲/▼ controls, supplied rather than derived from {@link label}.
	 *
	 * Deriving them produced "Increase am/pm", which is both mis-cased and semantically wrong: a
	 * two-value reel is not a quantity that goes up. Each column says what its own controls do.
	 */
	stepUpLabel: string;
	stepDownLabel: string;
	items: TumblerItem[];
	/** Index of the selected item within {@link items}. */
	index: number;
	/** `aria-valuenow` — the number PRINTED on the centre cell, not the internal value. */
	valueNow: number;
	valueMin: number;
	valueMax: number;
	/** Numeric columns take digits; the meridiem takes a letter. */
	numeric: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	describedBy?: string;
	invalid?: boolean;
	onPick: (item: TumblerItem) => void;
}

/** Live state of one pointer drag. Held in a ref: none of it may cause a render on its own. */
interface DragState {
	pointerId: number;
	startY: number;
	/** Cell height measured at press. Captured once so a re-render mid-drag cannot change the scale. */
	itemH: number;
	/** Selected index at press — every subsequent position is `base + steps`, never incremental. */
	baseIndex: number;
	/** Whether travel has passed {@link DRAG_THRESHOLD_PX}; below it the press is still a click. */
	active: boolean;
	steps: number;
	lastY: number;
	lastT: number;
	prevY: number;
	prevT: number;
}

/**
 * One reel of the tumbler: a `role="spinbutton"` whose centre cell is a real text input, so the
 * column that can be dragged, spun and stepped is the same element that can be TYPED into — rather
 * than a display with a hidden input beside it that has to be kept in agreement.
 *
 * The faded neighbours are `aria-hidden`: they are an affordance telling the eye which way the drum
 * turns, not content. A screen-reader listener gets the value once, from the spinbutton.
 */
function TumblerColumn(props: TumblerColumnProps): JSX.Element {
	const {
		id,
		label,
		stepUpLabel,
		stepDownLabel,
		items,
		index,
		valueNow,
		valueMin,
		valueMax,
		numeric,
		disabled,
		readOnly,
		describedBy,
		invalid,
		onPick,
	} = props;

	const viewportRef = useRef<HTMLDivElement>(null);
	const reelRef = useRef<HTMLDivElement>(null);
	const drag = useRef<DragState | null>(null);
	const wheelAcc = useRef(0);

	/**
	 * The sub-cell drag offset and the "a finger is down" flag.
	 *
	 * Signals rather than state because they are written from a raw pointer handler on every move;
	 * and the offset is DECORATION ONLY — the selected cell is chosen by `index`, which is layout, so
	 * a frozen animation clock leaves the reel resting in exactly the right place with this at zero.
	 */
	const residual = useRef(signal(0)).current;
	const dragging = useRef(signal(false)).current;

	const len = items.length;
	const current = items[index] ?? items[0];

	// #region Movement
	const pickAt = (next: number) => {
		if (disabled || readOnly || len === 0) return;
		const item = items[wrapIndex(next, len)];
		if (item) onPick(item);
	};
	const move = (delta: number) => pickAt(index + delta);

	/**
	 * The live `move` closure, for the non-passive wheel listener.
	 *
	 * That listener is bound once per enablement rather than on every render — re-adding a
	 * `{ passive: false }` listener each time a cell changes would mean adding and removing one on
	 * every notch of the wheel. Going through a ref is what keeps the handler current without making
	 * `index` a dependency of the binding.
	 */
	const moveRef = useRef(move);
	moveRef.current = move;

	const cellHeight = (): number => {
		const cell = reelRef.current?.firstElementChild as HTMLElement | null;
		return cell ? cell.getBoundingClientRect().height : 0;
	};
	// #endregion

	// #region Pointer drag
	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (disabled || readOnly || len === 0) return;
		const itemH = cellHeight();
		// An unmeasured cell means the reel is not laid out. Substituting a pixel guess would make the
		// same gesture mean different numbers of steps in different states, so the drag simply does not
		// start; the arrows, wheel, keyboard and typed entry all still work.
		if (!(itemH > 0)) return;
		drag.current = {
			pointerId: e.pointerId,
			startY: e.clientY,
			itemH,
			baseIndex: index,
			active: false,
			steps: 0,
			lastY: e.clientY,
			lastT: e.timeStamp,
			prevY: e.clientY,
			prevT: e.timeStamp,
		};
	};

	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		const dy = e.clientY - d.startY;

		if (!d.active) {
			// Below the threshold this is still a click, and a click is how the centre cell is focused
			// for typing. Promote to a drag only once the reader has clearly meant one.
			if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
			try {
				e.currentTarget.setPointerCapture(e.pointerId);
			} catch {
				// `setPointerCapture` throws NotFoundError when the pointer is already gone, and in Preact
				// this is a native listener, so an uncaught throw would abort the rest of the handler.
				//
				// Capture is NOT an optimisation here, so this abandons rather than carrying on: without
				// it a release outside the reel is delivered to whatever is under the pointer, `endDrag`
				// never runs, and the drag is stranded — `dragging` stuck on and the reel frozen at its
				// last sub-cell offset. The pointer is already gone in this case anyway.
				drag.current = null;
				dragging.value = false;
				residual.value = 0;
				return;
			}
			d.active = true;
			dragging.value = true;
		}

		d.prevY = d.lastY;
		d.prevT = d.lastT;
		d.lastY = e.clientY;
		d.lastT = e.timeStamp;

		const steps = dragSteps(dy, d.itemH);
		residual.value = dragResidual(dy, d.itemH, steps);
		if (steps !== d.steps) {
			d.steps = steps;
			pickAt(d.baseIndex + steps);
		}
	};

	const endDrag = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		drag.current = null;
		if (!d || !d.active) return;
		if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
			try {
				e.currentTarget.releasePointerCapture(e.pointerId);
			} catch {
				// Same NotFoundError window as capture — releasing a capture that is already gone must not
				// abort the flick and the reset below.
			}
		}

		// The flick is resolved to a whole number of cells HERE, from the velocity of the last two
		// samples, and committed in the same tick. There is no coasting animation to sample and nothing
		// to cancel, so a hidden tab lands on the same value as a visible one.
		//
		// The samples are only evidence of a THROW if the pointer was still moving when it left. A
		// reader who drags to a value, pauses to read it and then lifts produces a stale pair from
		// whenever they stopped — and flinging them past the value they had deliberately settled on is
		// the opposite of what they asked for. So the last sample has to be recent relative to the
		// release itself, which `e.timeStamp` measures on the same clock the samples were taken with.
		const sinceLastSample = e.timeStamp - d.lastT;
		const dt = d.lastT - d.prevT;
		const moving = sinceLastSample <= FLICK_STALE_MS;
		const flick = moving && dt > 0 ? flickSteps((d.lastY - d.prevY) / dt, d.itemH) : 0;
		if (flick !== 0) pickAt(index + flick);

		residual.value = 0;
		dragging.value = false;
	};
	// #endregion

	// #region Wheel
	useEffect(() => {
		const el = viewportRef.current;
		if (!el || disabled || readOnly) return;
		const onWheel = (e: WheelEvent) => {
			const itemH = cellHeight();
			if (!(itemH > 0)) return;
			// Non-passive so this can hold: without it the page scrolls behind an open picker while the
			// reader is trying to set a time.
			e.preventDefault();
			wheelAcc.current += wheelDeltaPx(e.deltaY, e.deltaMode, itemH);
			const steps = Math.trunc(wheelAcc.current / itemH);
			if (steps !== 0) {
				wheelAcc.current -= steps * itemH;
				// Scrolling DOWN moves the viewport down the list, so it reaches later values — the
				// opposite sign to a drag, which moves the drum itself. Both match the physical metaphor.
				moveRef.current(steps);
			}
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [disabled, readOnly]);
	// #endregion

	// #region Typed entry
	/**
	 * What the reader has typed so far, or `null` when the cell is showing the committed label.
	 *
	 * A buffer is needed because a partial entry is often not yet a value: on a 12-hour reel `0` names
	 * no hour, and refusing the keystroke would make `09` untypeable.
	 */
	const draft = useRef(signal<string | null>(null)).current;

	const onInput = (e: JSX.TargetedEvent<HTMLInputElement>) => {
		const text = e.currentTarget.value;
		draft.value = text;
		const found = resolveTyped(items, text, numeric);
		if (found >= 0) pickAt(found);
	};

	const commitDraft = () => {
		const text = draft.value;
		if (text !== null) {
			const found = resolveTyped(items, text, numeric);
			if (found >= 0) pickAt(found);
		}
		draft.value = null;
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		if (disabled || readOnly) return;
		switch (e.key) {
			case "ArrowUp":
				e.preventDefault();
				move(1);
				break;
			case "ArrowDown":
				e.preventDefault();
				move(-1);
				break;
			case "PageUp":
				e.preventDefault();
				move(quarterTurn(len));
				break;
			case "PageDown":
				e.preventDefault();
				move(-quarterTurn(len));
				break;
			case "Home":
				e.preventDefault();
				pickAt(0);
				break;
			case "End":
				e.preventDefault();
				pickAt(len - 1);
				break;
			case "Enter":
				e.preventDefault();
				commitDraft();
				break;
			default:
				return;
		}
		draft.value = null;
	};
	// #endregion

	const stepDisabled = disabled || readOnly || len < 2;

	return (
		<div class="ui-tumbler__col">
			{
				/*
				 * Up increments and down decrements, the spinbutton convention that ArrowUp/ArrowDown and
				 * every native number field already follow. On an ascending reel that means the top control
				 * brings the cell BELOW the centre up into it — which is what dragging upward does too, so
				 * the two gestures agree even though the arrow appears to point away from its target. The
				 * accessible name says "Increase"/"Decrease" rather than a direction, so nothing rests on
				 * reading the glyph.
				 *
				 * `tabIndex={-1}`, like a native spinner's buttons: Tab moves between COLUMNS, and the same
				 * function is on the focused column's Up/Down keys, so putting these in the tab order would
				 * triple its length without adding a capability.
				 */
			}
			<button
				type="button"
				class="ui-tumbler__step"
				aria-label={stepUpLabel}
				tabIndex={-1}
				disabled={stepDisabled}
				onClick={() => move(1)}
			>
				<Icon name="chevron-up" />
			</button>

			<div
				ref={viewportRef}
				class="ui-tumbler__viewport"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				<div
					ref={reelRef}
					class={cx("ui-tumbler__reel", dragging.value && "ui-tumbler__reel--dragging")}
					style={styleVars({ "--tmb-drag": `${residual.value}px` })}
				>
					{REEL_OFFSETS.map((k) => {
						const item = items[wrapIndex(index + k, len)];
						const depth = Math.abs(k);
						return (
							<span
								key={k}
								class={cx("ui-tumbler__cell", k !== 0 && "ui-tumbler__cell--ghost")}
								data-depth={depth}
								aria-hidden={k === 0 ? undefined : "true"}
							>
								{k === 0
									? (
										<input
											id={id}
											type="text"
											class="ui-tumbler__value"
											role="spinbutton"
											inputMode={numeric ? "numeric" : undefined}
											autocomplete="off"
											maxLength={2}
											// Load-bearing, and measured: an `<input>` defaults to `size="20"`, and a
											// percentage `inline-size` contributes nothing during intrinsic sizing, so
											// the centre cell's max-content was 20 characters. The reel is a column
											// flex container, so that width stretched every cell — a two-digit drum
											// measured 291px per cell and 600px overall. Two, because two is what the
											// column can ever hold.
											size={2}
											value={draft.value ?? current?.label ?? ""}
											aria-label={label}
											aria-describedby={describedBy}
											aria-valuenow={valueNow}
											aria-valuemin={valueMin}
											aria-valuemax={valueMax}
											// The printed label, so what is announced and what is on screen are the same
											// string. It is also the only honest reading of the meridiem column, whose
											// `aria-valuenow` is an index and means nothing on its own.
											aria-valuetext={current?.label ?? ""}
											aria-disabled={disabled || undefined}
											aria-readonly={readOnly || undefined}
											aria-invalid={invalid || undefined}
											disabled={disabled}
											readOnly={readOnly}
											onInput={onInput}
											onKeyDown={onKeyDown}
											onBlur={commitDraft}
										/>
									)
									: item?.label ?? ""}
							</span>
						);
					})}
				</div>
			</div>

			<button
				type="button"
				class="ui-tumbler__step"
				aria-label={stepDownLabel}
				tabIndex={-1}
				disabled={stepDisabled}
				onClick={() => move(-1)}
			>
				<Icon name="chevron-down" />
			</button>
		</div>
	);
}

// #endregion

/**
 * TimeTumbler — a drum-roll time picker: two vertical reels (three with `hour12`) drawn as a
 * combination lock, with the selected value large in the centre and its neighbours faded above and
 * below.
 *
 * Every way of turning a drum is wired: pointer drag and touch swipe with a velocity flick on
 * release, wheel and trackpad, the ▲/▼ controls, the keyboard (Up/Down, PageUp/PageDown a quarter
 * turn, Home/End the ends of the reel), and direct numeric entry into the centre cell. Each column
 * is a `role="spinbutton"` carrying full `aria-value*` state and its own name; the faded neighbours
 * are `aria-hidden`, because they are an affordance rather than content.
 *
 * **No committed value ever depends on an animation frame.** The selected cell is placed by LAYOUT,
 * a drag's whole cells are committed the moment they are crossed, and a flick is resolved from the
 * release velocity synchronously — so in a background tab, where `requestAnimationFrame` and every
 * CSS transition are frozen, the drum still lands on exactly the value the gesture asked for. The
 * reel's transform carries only the sub-cell remainder, which is decoration.
 *
 * `minMinutes`/`maxMinutes` narrow the reels themselves rather than merely rejecting a bad value
 * afterwards: an hour with no legal minute is not offered, a bounded hour offers only its legal
 * minutes, and a bound that does not sit on the `minuteStep` grid is offered anyway — otherwise a
 * coarse step would make the earliest legal time unreachable. Signal-first via `useControllable`.
 */
export function TimeTumbler(props: TimeTumblerProps): JSX.Element {
	const {
		value,
		onValueChange,
		hour12 = false,
		minuteStep = DEFAULT_MINUTE_STEP,
		minMinutes = 0,
		maxMinutes = MINUTES_PER_DAY - 1,
		id,
		name,
		disabled,
		readOnly,
		required,
		status = "default",
		size = "md",
		class: className,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<number>(value, 0, onValueChange);
	const rootId = useId(id, "tumbler");

	// A caller may hand over a reversed pair; ordering them is cheaper than refusing to render.
	const lo = clampToRange(Math.min(minMinutes, maxMinutes), 0, MINUTES_PER_DAY - 1);
	const hi = clampToRange(Math.max(minMinutes, maxMinutes), 0, MINUTES_PER_DAY - 1);

	// Reading `.value` here is what subscribes the component (§C.2 signal-first).
	const bound = ctrl.signal.value;
	const resolved = resolveMinutes(bound, minuteStep, lo, hi, hour12);

	/**
	 * Pull an out-of-range bound value onto a position the reels actually offer.
	 *
	 * Written in an effect rather than during render because a render must not have side effects, and
	 * keyed on both numbers so it settles in one pass and never loops: once `resolved === bound` there
	 * is nothing left to write. It also re-runs when the WINDOW moves, which is the real case — the
	 * day changed under a value that was legal on the previous one.
	 */
	useEffect(() => {
		if (resolved !== bound) ctrl.set(resolved);
	}, [resolved, bound]);

	// #region Column domains
	const hour = Math.floor(resolved / 60);
	const minute = resolved % 60;

	const meridiems = useMemo(() => (hour12 ? meridiemItems(lo, hi) : []), [hour12, lo, hi]);
	const meridiemIdx = hour12
		? Math.max(0, meridiems.findIndex((m) => m.value === (hour < 12 ? 0 : 1)))
		: 0;
	const meridiem = (hour12 ? meridiems[meridiemIdx]?.value ?? 0 : 0) as Meridiem;

	const hours = useMemo(
		() => hourItems(hour12, meridiem, lo, hi),
		[hour12, meridiem, lo, hi],
	);
	const hourIdx = Math.max(0, nearestIndex(hours, hour));
	const effectiveHour = hours[hourIdx]?.value ?? hour;

	const minutes = useMemo(
		() => minuteItems(effectiveHour, minuteStep, lo, hi),
		[effectiveHour, minuteStep, lo, hi],
	);
	const minuteIdx = Math.max(0, nearestIndex(minutes, minute));
	// #endregion

	// #region Commits
	/**
	 * Commit an hour with a minute that hour actually offers.
	 *
	 * Spinning the hour to a boundary is exactly where a naive picker goes wrong: keeping 17:45 while
	 * moving to an hour that ends at 17:00 produces a time the caller declared illegal, and the reader
	 * has no way to see that it happened.
	 */
	const commit = (h: number, m: number) => {
		if (disabled || readOnly) return;
		const offered = minuteItems(h, minuteStep, lo, hi);
		const idx = nearestIndex(offered, m);
		ctrl.set(clampToRange(h * 60 + (offered[idx]?.value ?? 0), lo, hi));
	};

	const pickHour = (item: TumblerItem) => commit(item.value, minute);
	const pickMinute = (item: TumblerItem) => commit(effectiveHour, item.value);
	const pickMeridiem = (item: TumblerItem) => {
		const half = item.value as Meridiem;
		const offered = hourItems(true, half, lo, hi);
		const idx = nearestIndex(offered, (effectiveHour % 12) + half * 12);
		commit(offered[idx]?.value ?? effectiveHour, minute);
	};
	// #endregion

	const hourLabels = hours.map((h) => Number(h.label));
	const minuteLabels = minutes.map((m) => Number(m.label));

	return (
		<div
			class={cx(
				"ui-tumbler",
				`ui-tumbler--size-${size}`,
				status !== "default" && `ui-tumbler--${status}`,
				disabled && "ui-tumbler--disabled",
				readOnly && "ui-tumbler--readonly",
				className,
			)}
			role="group"
			aria-label={ariaLabel ?? "Time"}
			aria-describedby={describedBy}
			aria-disabled={disabled || undefined}
			aria-required={required || undefined}
		>
			{name !== undefined && <input type="hidden" name={name} value={String(resolved)} />}

			<TumblerColumn
				id={`${rootId}-h`}
				label="Hours"
				stepUpLabel="Increase hours"
				stepDownLabel="Decrease hours"
				items={hours}
				index={hourIdx}
				valueNow={hourLabels[hourIdx] ?? 0}
				valueMin={hourLabels.length > 0 ? Math.min(...hourLabels) : 0}
				valueMax={hourLabels.length > 0 ? Math.max(...hourLabels) : 0}
				numeric
				disabled={disabled}
				readOnly={readOnly}
				describedBy={describedBy}
				invalid={ariaInvalid(status)}
				onPick={pickHour}
			/>

			<span class="ui-tumbler__sep" aria-hidden="true">:</span>

			<TumblerColumn
				id={`${rootId}-m`}
				label="Minutes"
				stepUpLabel="Increase minutes"
				stepDownLabel="Decrease minutes"
				items={minutes}
				index={minuteIdx}
				valueNow={minuteLabels[minuteIdx] ?? 0}
				valueMin={minuteLabels.length > 0 ? Math.min(...minuteLabels) : 0}
				valueMax={minuteLabels.length > 0 ? Math.max(...minuteLabels) : 0}
				numeric
				disabled={disabled}
				readOnly={readOnly}
				describedBy={describedBy}
				invalid={ariaInvalid(status)}
				onPick={pickMinute}
			/>

			{hour12 && (
				<TumblerColumn
					id={`${rootId}-a`}
					label="AM/PM"
					stepUpLabel="Next, AM or PM"
					stepDownLabel="Previous, AM or PM"
					items={meridiems}
					index={meridiemIdx}
					// The only honest `aria-valuenow` a two-word reel has is its position; `aria-valuetext`
					// carries the fact, which is exactly the case that attribute exists for.
					valueNow={meridiemIdx}
					valueMin={0}
					valueMax={Math.max(0, meridiems.length - 1)}
					numeric={false}
					disabled={disabled}
					readOnly={readOnly}
					describedBy={describedBy}
					invalid={ariaInvalid(status)}
					onPick={pickMeridiem}
				/>
			)}
		</div>
	);
}
