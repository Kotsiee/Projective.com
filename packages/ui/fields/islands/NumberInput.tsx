import type { CSSProperties, JSX } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/field.css";
import "../styles/number-input.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Icon, type IconName } from "../../icons/mod.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useHoldRepeat } from "../hooks/useHoldRepeat.ts";
import { useId } from "../hooks/useId.ts";
import { type ScrubAxis, useScrub } from "../hooks/useScrub.ts";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import {
	caretAfterSanitize,
	clampNumber,
	parseNumericInput,
	roundDecimals,
	sanitizeNumericInput,
	type ScrubAccelerationOptions,
	scrubDelta,
	snapToStep,
	stepDecimals,
} from "../core/number-field.ts";
import type { BaseFieldProps, Bindable, FieldVariant, ValueChange } from "../types/mod.ts";

/** Numeric formatting mode. */
export type NumberInputMode = "decimal" | "currency";
/**
 * Where the +/- pair sits.
 *
 *  - `adjacent` (default) - the two side by side in the trailing slot, `-` then `+`, reading left to
 *    right the way a number line does.
 *  - `stacked` - a vertical column, `+` above `-`.
 *  - `split` - the pair separated to flank the value, `-` leading and `+` trailing.
 */
export type StepperLayout = "adjacent" | "stacked" | "split";

export interface NumberInputProps extends BaseFieldProps {
	/** Bound numeric value; `null` is an empty field. */
	value?: Bindable<number | null>;
	/** Fired whenever a value is committed — a step, a scrub, a wheel notch, or a blur. */
	onValueChange?: ValueChange<number | null>;
	/**
	 * Placeholder text. Defaults to the field's own zero — `0.00` at two fraction digits, `0` at none
	 * — because a numeric field's placeholder is a format hint, and a word in a box that only accepts
	 * digits describes the value's absence rather than the shape of the value being asked for.
	 *
	 * Pass a string to override it (`"---"` where the emptiness itself is the point, or a word where
	 * the field is genuinely optional and the label does not already say so).
	 */
	placeholder?: string;
	/** `decimal` (default) or `currency` formatting via `Intl.NumberFormat`. */
	mode?: NumberInputMode;
	/** ISO 4217 code, used when `mode` is `currency`. */
	currency?: string;
	/** BCP-47 locale. Pass one explicitly wherever SSR output must match the client's. */
	locale?: string;
	/** Minimum fraction digits in the formatted output. */
	minFractionDigits?: number;
	/**
	 * Maximum fraction digits. Also decides the keypad: `0` is the only value from which the control
	 * can know it holds whole numbers, and it is what selects `inputmode="numeric"`.
	 */
	maxFractionDigits?: number;
	/** Lower bound. Steps, scrubs and commits clamp to it. */
	min?: number;
	/** Upper bound. Steps, scrubs and commits clamp to it. */
	max?: number;
	/** Granularity (default `1`). Also the unit a slow scrub moves in. */
	step?: number;
	/**
	 * The unit every gesture moves by while Ctrl (or Cmd) is held — arrows, wheel, steppers and the
	 * scrub alike (default `0.01`).
	 *
	 * Ignored on a field that declares `maxFractionDigits: 0`, which is a statement that it holds
	 * whole numbers: there, a fine step would produce a figure the next blur rounds away.
	 */
	precisionStep?: number;

	// #region Leading adornment
	/**
	 * A registry glyph in the leading slot. Also the scrub handle when {@link enableIconScrub} is set.
	 * Decorative: the value it drags is already fully operable from the input.
	 */
	icon?: IconName;
	/**
	 * Text in the leading slot instead of a glyph — a currency symbol, a unit. Derived from
	 * `currency` automatically in `currency` mode, so a caller rarely sets this.
	 *
	 * Text rather than an icon deliberately: a currency symbol is notation, not iconography, and the
	 * icon contract (§B.7) would need twelve new glyphs to say what `Intl` already says correctly for
	 * every locale.
	 */
	symbol?: string;
	/** Trailing text after the value (a unit — "days", "%"). */
	suffix?: string;
	// #endregion

	// #region Scrub
	/** Turn the leading adornment into a drag handle (default `false` — opt in). */
	enableIconScrub?: boolean;
	/** Drag axis (default `x`: right is more). */
	scrubAxis?: ScrubAxis;
	/** Unaccelerated pixels of travel per `step` (default `6`). */
	scrubPixelsPerStep?: number;
	/** Acceleration-curve tuning. See `scrubAcceleration`. */
	scrubAcceleration?: ScrubAccelerationOptions;
	/** Request Pointer Lock for unbounded travel (default `true`). */
	scrubPointerLock?: boolean;
	// #endregion

	// #region Keyboard & wheel
	/**
	 * Left/Right jump to `min`/`max` when BOTH bounds are defined (default `true`).
	 *
	 * It costs the caret keys, which is a real trade on a field somebody is mid-edit in, so it is one
	 * flag away from off and it never engages on a half-bounded field — where Left and Right keep
	 * their ordinary meaning.
	 */
	arrowBounds?: boolean;
	/**
	 * Step on wheel (default `true`).
	 *
	 * A plain wheel requires the field to hold focus; Ctrl/Cmd+wheel requires only that the pointer is
	 * over it, since a modifier plus a wheel turn over one specific field is not something anybody
	 * does by accident.
	 */
	enableWheel?: boolean;
	/** Override the derived keypad hint. */
	inputMode?: "numeric" | "decimal";
	// #endregion

	/** Stepper arrangement when steppers are shown (default `adjacent`). */
	buttonLayout?: StepperLayout;
	/** Hide the +/− steppers. */
	hideSteppers?: boolean;
	/** Surface treatment. */
	variant?: FieldVariant;
	class?: string;
	style?: CSSProperties;
}

/**
 * NumberInput — a numeric field built for direct manipulation.
 *
 * Four ways to reach the same figure, because the same field is used to set 3 seats and £250,000 and
 * no single gesture is good at both: type it, step it (click, or hold to ramp), scrub it (drag the
 * leading adornment — logarithmically accelerated, so a creep moves single steps and a flick covers
 * orders of magnitude), or spin the wheel over it.
 *
 * Everything that decides what a number BECOMES — clamping, snapping, rounding, the scrub curve —
 * lives in `core/number-field.ts` and is shared with {@link InputNumber}; this component owns only
 * the events. Two numeric controls that each rounded their own way would eventually disagree about
 * the same figure, and these fields carry prices.
 *
 * Sibling to `InputNumber`, not a replacement: that one is the quiet locale-formatted field for a
 * form you fill in once, this one is for a surface where a value is tuned repeatedly against a
 * number the reader is watching elsewhere on the page.
 *
 * ### Fine adjustment
 * Holding Ctrl (or Cmd) swaps the unit from `step` to `precisionStep` for EVERY gesture at once —
 * arrows, wheel, steppers and scrub — so "hold Ctrl to work in pennies" is one thing to learn rather
 * than four. It is read live per sample during a drag, so a reader can travel coarsely to the
 * neighbourhood of a figure and then hold Ctrl to creep onto the exact one without letting go.
 *
 * ### Currency
 * A currency field puts its symbol in the leading adornment and NOWHERE else; the box holds the bare
 * figure. That is what keeps the value editable — a symbol inside the string is something the reader
 * has to type around — and it is why the display formatter deliberately does not use `style:
 * "currency"`.
 *
 * ### Accessibility
 * The input is the `spinbutton` and holds the whole contract — `aria-valuenow`/`min`/`max`, and
 * `aria-valuetext`, which is formatted WITH the currency precisely because the visible text is not.
 * The steppers and the scrub handle are redundant pointer affordances over that one control, so they
 * stay out of the tab order rather than adding three stops per field to a form that has nine of them.
 */
export function NumberInput(props: NumberInputProps): JSX.Element {
	const {
		value,
		onValueChange,
		placeholder,
		mode = "decimal",
		currency = "USD",
		locale,
		minFractionDigits,
		maxFractionDigits,
		min,
		max,
		step = 1,
		precisionStep = 0.01,
		icon,
		symbol,
		suffix,
		enableIconScrub = false,
		scrubAxis = "x",
		scrubPixelsPerStep,
		scrubAcceleration: acceleration,
		scrubPointerLock = true,
		arrowBounds = true,
		enableWheel = true,
		inputMode,
		buttonLayout = "adjacent",
		hideSteppers,
		variant = "outlined",
		fluid,
		size = "md",
		status = "default",
		id,
		name,
		disabled,
		readOnly,
		required,
		loading,
		class: className,
		style,
		...aria
	} = props;

	const ctrl = useControllable<number | null>(value, null, onValueChange);
	const inputId = useId(id, "numberinput");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const rootRef = useRef<HTMLSpanElement | null>(null);
	const focused = useSignal(false);
	const draft = useSignal("");
	const locked = disabled || readOnly;

	// #region Formatting
	/**
	 * What the reader SEES in the box: the bare figure, never the currency.
	 *
	 * The currency lives in the leading adornment and nowhere else. Formatting the value with
	 * `style: "currency"` as well put it in both, and the field rendered `£ £120.00` — the symbol
	 * stated twice, one of them inside a string the reader is about to edit.
	 *
	 * Grouping is off so the blurred and focused states are the same shape. A field whose value
	 * visibly reflows the moment it takes focus (`1,250.50` → `1250.5`) reads as though the click
	 * changed something.
	 *
	 * `Intl.NumberFormat` throws a RangeError on an unknown currency code, and this runs inside
	 * render — an unrecognised code would take the whole page down rather than mis-format one field.
	 */
	const displayFormatter = useMemo(() => {
		try {
			return new Intl.NumberFormat(locale, {
				minimumFractionDigits: minFractionDigits,
				maximumFractionDigits: maxFractionDigits,
				useGrouping: false,
			});
		} catch {
			return new Intl.NumberFormat(locale, { useGrouping: false });
		}
	}, [locale, minFractionDigits, maxFractionDigits]);

	/**
	 * What a screen reader HEARS, via `aria-valuetext`.
	 *
	 * This one keeps `style: "currency"`, because the visible text no longer carries the currency and
	 * a listener would otherwise be told "120" with no idea of what. Built by `Intl` rather than by
	 * concatenating the symbol onto the number, so a locale that trails its symbol (`1 250,50 €`)
	 * still says it in the right place.
	 */
	const spokenFormatter = useMemo(() => {
		if (mode !== "currency") return null;
		try {
			return new Intl.NumberFormat(locale, {
				style: "currency",
				currency,
				minimumFractionDigits: minFractionDigits,
				maximumFractionDigits: maxFractionDigits,
			});
		} catch {
			return null;
		}
	}, [locale, mode, currency, minFractionDigits, maxFractionDigits]);

	/** The currency's own symbol for this locale, so the adornment reads "£" and never "GBP". */
	const leadingSymbol = useMemo(() => {
		if (symbol !== undefined) return symbol;
		if (mode !== "currency") return undefined;
		try {
			const parts = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0);
			return parts.find((p) => p.type === "currency")?.value ?? currency;
		} catch {
			return currency;
		}
	}, [symbol, mode, currency, locale]);

	const current = ctrl.signal.value;
	const hasValue = current !== null && current !== undefined;
	const formatted = hasValue ? displayFormatter.format(current) : "";
	const spoken = hasValue && spokenFormatter ? spokenFormatter.format(current) : formatted;
	const display = focused.value ? draft.value : formatted;
	/**
	 * The field's own zero, formatted exactly as a real value would be, so the hint shows the shape
	 * the box expects. Derived from the display formatter rather than written as a literal `"0.00"`,
	 * which would be wrong the moment a field carries a different precision — or a Yen figure.
	 */
	const resolvedPlaceholder = placeholder ?? displayFormatter.format(0);
	// #endregion

	// #region Fine-adjustment mode
	/**
	 * Whether this field can REPRESENT a fine step at all.
	 *
	 * `maxFractionDigits: 0` is a declaration that the field holds whole numbers, and it is what
	 * `settleTyped` rounds to. Letting Ctrl move a seat count to `3.01` would produce a figure the
	 * next blur silently rounds away — a modifier that appears to work and then discards its own
	 * result. On such a field the modifier falls through to the ordinary step, which still acts (and
	 * so still earns its `preventDefault` against the browser's zoom).
	 */
	const holdsDecimals = maxFractionDigits === undefined || maxFractionDigits > 0;

	/**
	 * Is the fine-adjustment modifier down? Ctrl on Windows/Linux, Cmd on macOS.
	 *
	 * Separate from {@link isFine} on purpose. This one answers "did the reader ASK for fine mode",
	 * which is what decides whether the wheel engages on hover and whether it cancels the browser's
	 * zoom; {@link isFine} answers "can this field DELIVER it", which only decides the unit. Folding
	 * them together would let a whole-number field silently hand Ctrl+wheel back to the browser and
	 * zoom the page, while its neighbour on the same row stepped.
	 */
	const hasFineModifier = (event: { ctrlKey?: boolean; metaKey?: boolean }): boolean =>
		event.ctrlKey === true || event.metaKey === true;

	/** The modifier is down AND this field can represent the finer unit. */
	const isFine = (event: { ctrlKey?: boolean; metaKey?: boolean }): boolean =>
		holdsDecimals && hasFineModifier(event);

	/** The unit one gesture moves by, standard or fine. */
	const unitFor = (fine: boolean): number => (fine ? precisionStep : step);
	// #endregion

	// #region Value commits
	/**
	 * What a GESTURE produces: clamped, and snapped onto the grid of the unit it moved by, anchored
	 * at `min`. A stepper press or a scrub is a request to move by a unit, so it should land on one —
	 * and in fine mode that grid is the fine one, or a 0.01 nudge would snap straight back to a whole
	 * number and appear to do nothing.
	 */
	const settleGesture = (n: number, unit: number): number =>
		clampNumber(snapToStep(n, unit, min ?? 0), min, max);

	/**
	 * What TYPING produces: clamped, and rounded only to the precision the field actually displays.
	 *
	 * Deliberately NOT snapped. `step` is the size of a nudge, not a statement about which values are
	 * legal — a currency field steps by whole pounds and must still accept `12.50`, and snapping the
	 * typed figure would silently rewrite it as `13` on blur. Rounding is applied only when the caller
	 * has said what the precision is; with no `maxFractionDigits` the number is left exactly as typed.
	 */
	const settleTyped = (n: number): number =>
		clampNumber(
			maxFractionDigits === undefined ? n : roundDecimals(n, maxFractionDigits),
			min,
			max,
		);

	const parseDraft = (): number | null => {
		const parsed = parseNumericInput(draft.value);
		return parsed === null ? null : settleTyped(parsed);
	};

	const commit = (next: number | null) => {
		if (next === ctrl.get()) return false;
		ctrl.set(next);
		if (focused.value) draft.value = next === null ? "" : String(next);
		return true;
	};

	const stepBy = (direction: 1 | -1, fine = false): boolean => {
		if (locked) return false;
		const unit = unitFor(fine);
		return commit(settleGesture((ctrl.get() ?? 0) + direction * unit, unit));
	};

	const jumpTo = (bound: number) => {
		if (locked) return;
		commit(settleGesture(bound, step));
	};
	// #endregion

	// #region Scrub
	// The anchor the gesture measures from, and the sub-step travel banked since it was set. Refs, not
	// signals: a scrub writes these on every pointer sample and none of it is rendered, so a signal
	// would re-render the field for a fact nothing reads.
	const anchor = useRef(0);
	const banked = useRef(0);

	const scrub = useScrub({
		axis: scrubAxis,
		disabled: locked || !enableIconScrub,
		pointerLock: scrubPointerLock,
		onStart: () => {
			anchor.current = ctrl.get() ?? 0;
			banked.current = 0;
		},
		onMove: (movementPx, elapsedMs, event) => {
			// Read live, per sample, so the modifier can be taken and released mid-drag: travel coarsely
			// to the neighbourhood of a figure, then hold Ctrl and creep onto the exact pence.
			//
			// Swapping the unit IS the damping the brief asks for. With the shipped defaults the fine
			// unit is 1/100th of the standard one, so every pixel of travel is worth a hundredth of
			// what it was — and it stays correct for a caller who sets `precisionStep` to 0.1 instead,
			// where a hardcoded ÷100 would silently disagree with the arrow keys and the wheel.
			const unit = unitFor(isFine(event));
			banked.current += scrubDelta({
				movementPx,
				elapsedMs,
				step: unit,
				pixelsPerStep: scrubPixelsPerStep,
				acceleration,
			});
			const snapped = snapToStep(anchor.current + banked.current, unit, min ?? 0);
			const next = clampNumber(snapped, min, max);
			if (next !== snapped) {
				// Re-anchor at the bound rather than letting the overshoot bank. Without this, a drag
				// that ran 4000 past `max` has to be dragged 4000 back before the value moves again,
				// and the control reads as broken for the whole of that return journey.
				anchor.current = next;
				banked.current = 0;
			}
			commit(next);
		},
	});
	// #endregion

	// #region Steppers
	const atMax = max !== undefined && hasValue && current >= max;
	const atMin = min !== undefined && hasValue && current <= min;
	// The initiating pointerdown reaches every tick, so a press begun with Ctrl held ramps in fine
	// units for the whole hold.
	const incHold = useHoldRepeat({ onTick: (e) => stepBy(1, isFine(e)), disabled: locked || atMax });
	const decHold = useHoldRepeat({
		onTick: (e) => stepBy(-1, isFine(e)),
		disabled: locked || atMin,
	});
	// #endregion

	// #region Wheel
	// Attached by hand rather than through `onWheel` so `{ passive: false }` is explicit and
	// `preventDefault` is guaranteed to hold: a wheel listener that cannot cancel the event scrolls
	// the page out from under the field it is editing.
	const stepRef = useRef(stepBy);
	stepRef.current = stepBy;
	const fineRef = useRef(isFine);
	fineRef.current = isFine;
	useEffect(() => {
		const root = rootRef.current;
		const input = inputRef.current;
		if (!root || !input || !enableWheel) return;
		const onWheel = (event: WheelEvent) => {
			// Two gates, because the two gestures ask for different things.
			//
			// A PLAIN wheel needs focus. The event reaches this listener merely because the pointer is
			// over the field, and a reader scrolling a long form past it did not ask to change anything
			// — without the gate, scrolling this page would rewrite every number it passed.
			//
			// Ctrl+wheel needs only HOVER. It is unambiguous: nobody holds a modifier and turns the
			// wheel over a specific number field by accident, so demanding a click first would only
			// make the gesture unreliable. The cost is that the browser's page zoom is taken over any
			// field the pointer happens to rest on, which is a real WCAG 1.4.4 trade and a deliberate
			// one — zoom is still reachable by keyboard and by the browser's own menu.
			const modified = event.ctrlKey || event.metaKey;
			if (!modified && input.ownerDocument.activeElement !== input) return;
			const delta = event.deltaY !== 0 ? -event.deltaY : event.deltaX;
			if (delta === 0) return;
			// Before stepping, and unconditionally once we have decided to act: with Ctrl held this is
			// the browser's page-zoom gesture, and a listener that steps the value without cancelling
			// it would adjust the figure and zoom the page in the same motion. This is why the listener
			// is non-passive and why it is on the CONTAINER — the pointer is often over the adornment
			// or a stepper rather than the text when the wheel turns.
			event.preventDefault();
			stepRef.current(delta > 0 ? 1 : -1, fineRef.current(event));
		};
		root.addEventListener("wheel", onWheel, { passive: false });
		return () => root.removeEventListener("wheel", onWheel);
	}, [enableWheel]);
	// #endregion

	// #region Keyboard & text entry
	const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowUp":
				event.preventDefault();
				stepBy(1, isFine(event));
				return;
			case "ArrowDown":
				event.preventDefault();
				stepBy(-1, isFine(event));
				return;
			case "ArrowLeft":
			case "ArrowRight": {
				// Only a fully bounded field spends its caret keys on this. On a half-bounded one there
				// is no symmetric pair to offer, so Left and Right keep the meaning every text field has.
				if (!arrowBounds || min === undefined || max === undefined) return;
				event.preventDefault();
				jumpTo(event.key === "ArrowLeft" ? min : max);
				return;
			}
			case "Enter":
				// Commit without cancelling the event, so a field inside a form still submits — with the
				// figure just typed rather than the one it held before the keystroke.
				commit(parseDraft());
				return;
		}
	};

	/**
	 * What this field accepts as it is typed, read off its own bounds rather than configured: a field
	 * whose `min` is `0` has no use for a sign, and one that declares no fraction digits has no use
	 * for a point.
	 */
	const filterOptions = {
		allowNegative: min === undefined || min < 0,
		allowDecimal: holdsDecimals,
	};

	/**
	 * Filter every keystroke, rather than letting junk sit in the box until a blur quietly empties it.
	 *
	 * The write-back is the part that is easy to miss. Typing `a` onto `12` filters back to `12`, so
	 * the signal does NOT change, so Preact does not re-render, so the `a` the browser already put in
	 * the DOM stays on screen — a rejected character that is only rejected in the model. The element
	 * has to be corrected by hand, and the caret restored with it, or fixing a typo in the middle of
	 * `1250.00` throws the reader to the far end of the figure on the very keystroke they used to fix
	 * it.
	 */
	const onInput = (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
		const el = event.currentTarget;
		const raw = el.value;
		const clean = sanitizeNumericInput(raw, filterOptions);
		draft.value = clean;
		if (clean === raw) return;
		const caret = caretAfterSanitize(raw, el.selectionStart ?? raw.length, filterOptions);
		el.value = clean;
		el.setSelectionRange(caret, caret);
	};

	const onFocus = () => {
		const v = ctrl.get();
		draft.value = v === null || v === undefined ? "" : String(v);
		focused.value = true;
	};

	const onBlur = () => {
		// Through `commit`, so a blur that changed nothing emits nothing. An unconditional `set` here
		// fires `onValueChange` for every field merely tabbed through, and a form that tracks unsaved
		// changes by comparing against its baseline then reads as dirty because somebody looked at it.
		commit(parseDraft());
		focused.value = false;
	};
	// #endregion

	const decimals = stepDecimals(step);
	const resolvedInputMode = inputMode ??
		(maxFractionDigits === 0 && decimals === 0 ? "numeric" : "decimal");
	const split = !hideSteppers && buttonLayout === "split";
	const scrubbing = scrub.active.value;

	const lead = (icon || leadingSymbol !== undefined)
		? (
			<span
				class={cx(
					"ui-number-input__lead",
					enableIconScrub && !locked && "ui-number-input__lead--scrub",
				)}
				data-axis={enableIconScrub ? scrubAxis : undefined}
				// A glyph here is decorative — the value it drags is spoken by the input, which also
				// carries the formatted figure in `aria-valuetext`. A SYMBOL is notation and stays
				// readable, because it is the only thing on an empty field that names the currency.
				aria-hidden={icon && leadingSymbol === undefined ? "true" : undefined}
				{...(enableIconScrub && !locked ? scrub.handlers : {})}
			>
				{icon ? <Icon name={icon} /> : leadingSymbol}
			</span>
		)
		: null;

	const stepper = (direction: 1 | -1) => {
		const inc = direction === 1;
		const hold = inc ? incHold : decHold;
		return (
			<button
				type="button"
				class={cx(
					"ui-number-input__step",
					inc ? "ui-number-input__step--inc" : "ui-number-input__step--dec",
				)}
				aria-label={inc ? "Increment" : "Decrement"}
				aria-controls={inputId}
				// Out of the tab order on purpose: ArrowUp/ArrowDown on the input does exactly this, and
				// native number spinners are not focusable either.
				tabIndex={-1}
				disabled={locked || (inc ? atMax : atMin)}
				data-holding={hold.holding.value ? "true" : undefined}
				{...hold.handlers}
			>
				<Icon name={inc ? "plus" : "minus"} size="2xs" />
			</button>
		);
	};

	return (
		<span
			ref={rootRef}
			class={cx(
				"ui-field",
				"ui-number-input",
				split && "ui-number-input--split",
				...fieldModifiers("ui-field", {
					size,
					variant,
					status,
					fluid,
					disabled,
					readOnly,
					loading,
					focused: focused.value,
				}),
				className,
			)}
			data-scrubbing={scrubbing ? "true" : undefined}
			style={style && styleVars({}, style)}
		>
			{split ? stepper(-1) : lead}
			{split && lead}
			<input
				ref={inputRef}
				id={inputId}
				name={name}
				type="text"
				inputMode={resolvedInputMode}
				role="spinbutton"
				class="ui-field__input ui-number-input__input"
				value={display}
				placeholder={resolvedPlaceholder}
				disabled={disabled}
				readOnly={readOnly}
				required={required}
				autocomplete="off"
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				aria-busy={loading || undefined}
				aria-valuenow={hasValue ? current : undefined}
				aria-valuemin={min}
				aria-valuemax={max}
				// Omitted when it would only repeat `aria-valuenow` — a listener gains nothing from
				// hearing "1500, 1500" and loses the signal that the text is saying something extra.
				aria-valuetext={hasValue && spoken !== String(current) ? spoken : undefined}
				onFocus={onFocus}
				onInput={onInput}
				onBlur={onBlur}
				onKeyDown={onKeyDown}
				{...aria}
			/>
			{suffix !== undefined && <span class="ui-number-input__suffix">{suffix}</span>}
			{!hideSteppers && (split ? stepper(1) : (
				<span
					class={cx("ui-number-input__steppers", `ui-number-input__steppers--${buttonLayout}`)}
				>
					{buttonLayout === "adjacent" ? stepper(-1) : stepper(1)}
					{buttonLayout === "adjacent" ? stepper(1) : stepper(-1)}
				</span>
			))}
		</span>
	);
}
