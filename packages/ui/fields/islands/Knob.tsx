import type { CSSProperties, JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/knob.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

export interface KnobProps extends Omit<BaseFieldProps, "fluid" | "size"> {
	/** Bound value (`min`…`max`) — raw (uncontrolled) or a `Signal` (controlled). */
	value?: Bindable<number>;
	/** Fired when the value changes. */
	onValueChange?: ValueChange<number>;
	/** Lower bound (default `0`). */
	min?: number;
	/** Upper bound (default `100`). */
	max?: number;
	/** Step granularity for keyboard/drag snapping (default `1`). */
	step?: number;
	/** Pixel diameter of the dial (default `100`). Distinct from the field size ramp. */
	diameter?: number;
	/** Arc stroke thickness in SVG user units (default `14`). */
	strokeWidth?: number;
	/** Colour of the value arc — a token reference (default `var(--primary)`). */
	valueColor?: string;
	/** Colour of the range (track) arc — a token reference (default `var(--surface-2)`). */
	rangeColor?: string;
	/** Render the value in the centre of the dial. */
	showValue?: boolean;
	/** Template for the centre text, `{value}` is substituted (default `"{value}"`). */
	valueTemplate?: string;
	class?: string;
	style?: CSSProperties;
}

// #region Arc geometry
/** Start of the sweep (bottom-left) in radians, math convention (y-up). */
const MIN_RADIANS = (4 * Math.PI) / 3;
/** End of the sweep (bottom-right) in radians. */
const MAX_RADIANS = -Math.PI / 3;
/** Guard angle at the bottom gap used to disambiguate pointer position. */
const START_GUARD = -Math.PI / 2 - Math.PI / 6;

/** Linear re-map of `x` from the input range onto the output range. */
function mapRange(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
	return ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

/** Clamp `n` into `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}
// #endregion

/**
 * Knob — a circular dial. Draws a background range arc and a value arc (from a bottom-left start,
 * sweeping clockwise) as SVG. Exposed as a `role="slider"` with `aria-valuemin/max/now`, focusable
 * and operable by keyboard (Arrow ±step, PageUp/Down ±10·step, Home/End). Pointer drag maps the angle
 * around the centre to a value. Colours arrive as token-referencing custom properties; the pixel
 * `diameter` is independent of the field size ramp. Signal-first via {@link useControllable}.
 */
export function Knob(props: KnobProps): JSX.Element {
	const {
		value,
		onValueChange,
		min = 0,
		max = 100,
		step = 1,
		diameter = 100,
		strokeWidth = 14,
		valueColor = "var(--primary)",
		rangeColor = "var(--surface-2)",
		showValue = true,
		valueTemplate = "{value}",
		readOnly,
		disabled,
		status = "default",
		id,
		name,
		class: className,
		style,
		"aria-label": ariaLabel,
		"aria-describedby": describedBy,
	} = props;

	const ctrl = useControllable<number>(value, min, onValueChange);
	const rootId = useId(id, "knob");
	const svgRef = useRef<SVGSVGElement>(null);
	const dragging = useRef(false);
	const locked = disabled || readOnly;

	const v = clamp(ctrl.signal.value, min, max);

	// #region Snap + write
	const snap = (raw: number): number => {
		const stepped = Math.round((raw - min) / step) * step + min;
		return clamp(Math.round(stepped * 1e6) / 1e6, min, max);
	};
	const write = (raw: number) => {
		if (locked) return;
		ctrl.set(snap(raw));
	};
	// #endregion

	// #region Path derivation
	const radius = 50 - strokeWidth / 2;
	const valueRadians = mapRange(v, min, max, MIN_RADIANS, MAX_RADIANS);
	const minX = 50 + radius * Math.cos(MIN_RADIANS);
	const minY = 50 - radius * Math.sin(MIN_RADIANS);
	const maxX = 50 + radius * Math.cos(MAX_RADIANS);
	const maxY = 50 - radius * Math.sin(MAX_RADIANS);
	const valueX = 50 + radius * Math.cos(valueRadians);
	const valueY = 50 - radius * Math.sin(valueRadians);
	const largeArc = Math.abs(MIN_RADIANS - valueRadians) < Math.PI ? 0 : 1;
	const rangePath = `M ${minX} ${minY} A ${radius} ${radius} 0 1 1 ${maxX} ${maxY}`;
	const valuePath = `M ${minX} ${minY} A ${radius} ${radius} 0 ${largeArc} 1 ${valueX} ${valueY}`;
	// #endregion

	// #region Pointer interaction
	const angleToValue = (clientX: number, clientY: number): number | undefined => {
		const el = svgRef.current;
		if (!el) return undefined;
		const rect = el.getBoundingClientRect();
		const dx = clientX - rect.left - rect.width / 2;
		const dy = rect.height / 2 - (clientY - rect.top);
		const angle = Math.atan2(dy, dx);
		if (angle > MAX_RADIANS) return mapRange(angle, MIN_RADIANS, MAX_RADIANS, min, max);
		if (angle < START_GUARD) {
			return mapRange(angle + 2 * Math.PI, MIN_RADIANS, MAX_RADIANS, min, max);
		}
		return undefined;
	};

	const onDown = (e: JSX.TargetedPointerEvent<SVGSVGElement>) => {
		if (locked) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		e.currentTarget.focus();
		dragging.current = true;
		const mapped = angleToValue(e.clientX, e.clientY);
		if (mapped !== undefined) write(mapped);
	};
	const onMove = (e: JSX.TargetedPointerEvent<SVGSVGElement>) => {
		if (!dragging.current) return;
		const mapped = angleToValue(e.clientX, e.clientY);
		if (mapped !== undefined) write(mapped);
	};
	const onUp = (e: JSX.TargetedPointerEvent<SVGSVGElement>) => {
		if (!dragging.current) return;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		dragging.current = false;
	};
	// #endregion

	// #region Keyboard interaction
	const onKey = (e: JSX.TargetedKeyboardEvent<SVGSVGElement>) => {
		if (locked) return;
		let next: number | undefined;
		switch (e.key) {
			case "ArrowRight":
			case "ArrowUp":
				next = v + step;
				break;
			case "ArrowLeft":
			case "ArrowDown":
				next = v - step;
				break;
			case "PageUp":
				next = v + step * 10;
				break;
			case "PageDown":
				next = v - step * 10;
				break;
			case "Home":
				next = min;
				break;
			case "End":
				next = max;
				break;
			default:
				return;
		}
		e.preventDefault();
		write(next);
	};
	// #endregion

	const label = valueTemplate.replace("{value}", String(v));

	return (
		<div
			id={rootId}
			class={cx(
				"ui-knob",
				readOnly && "ui-knob--readonly",
				disabled && "ui-knob--disabled",
				status !== "default" && `ui-knob--${status}`,
				className,
			)}
			style={styleVars(
				{
					"--ui-knob-diameter": `${diameter}px`,
					"--ui-knob-value-color": status === "invalid" ? "var(--danger)" : valueColor,
					"--ui-knob-range-color": rangeColor,
				},
				style,
			)}
		>
			{name !== undefined && <input type="hidden" name={name} value={String(v)} />}
			<svg
				ref={svgRef}
				class="ui-knob__svg"
				viewBox="0 0 100 100"
				role="slider"
				tabIndex={disabled ? -1 : 0}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={v}
				aria-valuetext={showValue ? label : undefined}
				aria-label={ariaLabel}
				aria-describedby={describedBy}
				aria-disabled={disabled || undefined}
				aria-readonly={readOnly || undefined}
				onPointerDown={onDown}
				onPointerMove={onMove}
				onPointerUp={onUp}
				onPointerCancel={onUp}
				onKeyDown={onKey}
			>
				<path
					class="ui-knob__range"
					d={rangePath}
					stroke-width={strokeWidth}
					stroke-linecap="round"
				/>
				<path
					class="ui-knob__value"
					d={valuePath}
					stroke-width={strokeWidth}
					stroke-linecap="round"
				/>
				{showValue && (
					<text class="ui-knob__text" x="50" y="50" font-size={Math.round(diameter * 0.18)}>
						{label}
					</text>
				)}
			</svg>
		</div>
	);
}
