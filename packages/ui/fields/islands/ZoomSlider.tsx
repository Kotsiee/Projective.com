import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/zoom-slider.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Icon } from "../../icons/mod.ts";
import { Button } from "../components/Button.tsx";
import { useControllable } from "../hooks/useControllable.ts";
import { useHoldRepeat } from "../hooks/useHoldRepeat.ts";
import type { Bindable, FieldSize } from "../types/mod.ts";

/**
 * What moved a {@link ZoomSlider}: `"drag"` follows the pointer 1:1 and should land at once; `"step"`
 * is a discrete jump (± button, held button, Arrow / Page / Home / End) and may be eased.
 */
export type ZoomChangeSource = "drag" | "step";

/**
 * ZoomSlider — the ONE zoom control on the platform: a zoom-out lens button, a muted track (no
 * progress fill) with optional segment markers and optional transition markers (`center`, or several
 * `marks` for a track cut into more than two zones), a neutral
 * draggable handle, and a zoom-in lens button. The buttons are ghost circles that step once on a
 * press and repeat while held (`useHoldRepeat`), stopping at a bound or on release; a held `Ctrl` /
 * `Cmd` at press asks for a fine step.
 *
 * Signal-first (`Bindable`): pass a `Signal` so a `Ctrl`+wheel handler elsewhere and this slider
 * drive one shared value. A surface whose step is not linear in the slider value (a logarithmic
 * viewer zoom, a snapped crop zoom) passes {@link ZoomSliderProps.onStep} and keeps its own maths.
 *
 * `role="slider"` with full `aria-valuemin/max/now` + Arrow/Home/End/PageUp/Down keyboard; the track
 * is pointer-draggable (1:1, capture-based) and steps on `Ctrl` / `Cmd` + wheel while hovered.
 * Token-only, reduced-motion aware. Dumb island.
 */
export interface ZoomSliderProps {
	/** Current zoom (raw = uncontrolled; `Signal` = controlled). */
	value?: Bindable<number>;
	onValueChange?: (value: number, source: ZoomChangeSource) => void;
	min?: number;
	max?: number;
	/** Step for the ± buttons + Arrow keys (default `(max - min) / 10`). */
	step?: number;
	/** Segments the track is divided into → `segments + 1` markers; `0` draws none (default `8`). */
	segments?: number;
	/** Position of the distinct centre "transition" marker; `null` draws none (default the midpoint). */
	center?: number | null;
	/**
	 * Positions of several transition markers, drawn like {@link center} — the boundaries of a track
	 * cut into more than two zones. Given, it replaces the centre marker.
	 */
	marks?: readonly number[];
	/**
	 * Replaces the ± button step. Answers whether the value moved, so a held button stops at a bound.
	 * `fine` is true while `Ctrl` / `Cmd` was held at press.
	 */
	onStep?: (direction: 1 | -1, fine: boolean) => boolean;
	size?: FieldSize;
	/** Block interaction; removes the track and both buttons from the tab order. */
	disabled?: boolean;
	/** Show the value, refuse the edit — still focusable and announced, unlike `disabled`. */
	readOnly?: boolean;
	/**
	 * Formats the spoken value for `aria-valuetext`. A zoom slider announcing "0.62" tells a listener
	 * nothing; give it the unit the surface actually means (`(v) => \`\${Math.round(v * 200)}%\``).
	 */
	formatValue?: (value: number) => string;
	"aria-label"?: string;
	class?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const FINE_DIVISOR = 5;

interface ZoomStepButtonProps {
	direction: 1 | -1;
	disabled: boolean;
	onStep: (direction: 1 | -1, fine: boolean) => boolean;
}

function ZoomStepButton({ direction, disabled, onStep }: ZoomStepButtonProps): JSX.Element {
	const hold = useHoldRepeat({
		disabled,
		onTick: (initiator) => onStep(direction, initiator.ctrlKey || initiator.metaKey),
	});
	const label = direction > 0 ? "Zoom in" : "Zoom out";
	return (
		<Button
			iconOnly
			rounded
			size="sm"
			variant="text"
			severity="secondary"
			class="ui-zoom__btn ui-hit"
			icon={<Icon name={direction > 0 ? "zoom-in" : "zoom-out"} size="sm" />}
			aria-label={label}
			disabled={disabled}
			data-holding={hold.holding.value ? "true" : undefined}
			{...hold.handlers}
			onClick={(e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
				if (e.detail === 0) onStep(direction, e.ctrlKey || e.metaKey);
			}}
		/>
	);
}

export function ZoomSlider(props: ZoomSliderProps): JSX.Element {
	const {
		value,
		onValueChange,
		min = 0,
		max = 1,
		step = (max - min) / 10,
		segments = 8,
		center = (min + max) / 2,
		marks,
		onStep,
		size = "sm",
		disabled,
		readOnly,
		formatValue,
		"aria-label": ariaLabel = "Zoom",
		class: className,
	} = props;

	/** Disabled blocks everything; read-only blocks the write but keeps focus and announcement. */
	const locked = Boolean(disabled || readOnly);

	const source = useRef<ZoomChangeSource>("step");
	const ctrl = useControllable<number>(
		value,
		clamp((min + max) / 2, min, max),
		onValueChange ? (next) => onValueChange(next, source.current) : undefined,
	);
	const trackRef = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);

	const v = clamp(ctrl.signal.value, min, max);
	const pct = (n: number) => ((clamp(n, min, max) - min) / (max - min)) * 100;

	const write = (next: number, from: ZoomChangeSource) => {
		source.current = from;
		ctrl.set(clamp(next, min, max));
	};

	const stepBy = (direction: 1 | -1, fine: boolean): boolean => {
		if (onStep) return onStep(direction, fine);
		const before = clamp(ctrl.signal.peek(), min, max);
		write(before + direction * (fine ? step / FINE_DIVISOR : step), "step");
		return clamp(ctrl.signal.peek(), min, max) !== before;
	};

	const setFromClientX = (clientX: number) => {
		const el = trackRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0) return;
		const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
		write(min + ratio * (max - min), "drag");
	};

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (locked || e.button !== 0) return;
		dragging.current = true;
		e.currentTarget.setPointerCapture(e.pointerId);
		setFromClientX(e.clientX);
	};
	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		setFromClientX(e.clientX);
	};
	const onPointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		dragging.current = false;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
	};

	const onWheel = (e: JSX.TargetedWheelEvent<HTMLDivElement>) => {
		if (locked || !(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
		e.preventDefault();
		stepBy(e.deltaY < 0 ? 1 : -1, false);
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		if (locked) return;
		let next: number | null = null;
		if (e.key === "ArrowRight" || e.key === "ArrowUp") next = v + step;
		else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = v - step;
		else if (e.key === "PageUp") next = v + step * 3;
		else if (e.key === "PageDown") next = v - step * 3;
		else if (e.key === "Home") next = min;
		else if (e.key === "End") next = max;
		if (next === null) return;
		e.preventDefault();
		write(next, "step");
	};

	const ticks = segments > 0
		? Array.from({ length: segments + 1 }, (_, i) => (i / segments) * 100)
		: [];
	const transitions = marks ?? (center !== null ? [center] : []);

	return (
		<div
			class={cx(
				"ui-zoom",
				`ui-zoom--size-${size}`,
				disabled && "ui-zoom--disabled",
				readOnly && "ui-zoom--readonly",
				className,
			)}
		>
			<ZoomStepButton direction={-1} disabled={locked || v <= min} onStep={stepBy} />

			<div
				ref={trackRef}
				class="ui-zoom__track ui-hit"
				role="slider"
				tabIndex={disabled ? -1 : 0}
				aria-label={ariaLabel}
				aria-orientation="horizontal"
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={Math.round(v * 100) / 100}
				aria-valuetext={formatValue ? formatValue(v) : undefined}
				aria-disabled={disabled || undefined}
				aria-readonly={readOnly || undefined}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onWheel={onWheel}
				onKeyDown={onKeyDown}
			>
				<div class="ui-zoom__rail" aria-hidden="true" />
				{ticks.length > 0
					? (
						<div class="ui-zoom__ticks" aria-hidden="true">
							{ticks.map((t, i) => (
								<span key={i} class="ui-zoom__tick" style={styleVars({ "--tick": `${t}%` })} />
							))}
						</div>
					)
					: null}
				{transitions.map((t, i) => (
					<span
						key={`m${i}`}
						class="ui-zoom__center"
						style={styleVars({ "--tick": `${pct(t)}%` })}
						aria-hidden="true"
					/>
				))}
				<span
					class="ui-zoom__handle"
					style={styleVars({ "--zoom-pct": `${pct(v)}%` })}
					aria-hidden="true"
				/>
			</div>

			<ZoomStepButton direction={1} disabled={locked || v >= max} onStep={stepBy} />
		</div>
	);
}
