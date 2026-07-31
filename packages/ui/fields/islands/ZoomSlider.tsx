import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/zoom-slider.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import type { Bindable, FieldSize } from "../types/mod.ts";

/**
 * ZoomSlider — a compact zoom control: a minus button, a thin track with evenly-spaced segment
 * markers and a distinct centered transition marker, a draggable handle, and a plus button. Built for
 * a view-density rig where crossing the centre marker flips a workspace between two presentations
 * (e.g. list ⇄ grid) and the value within each half scales the density. Signal-first (`Bindable`):
 * pass a `Signal` so a `Ctrl`+wheel handler elsewhere and this slider drive one shared value.
 *
 * `role="slider"` with full `aria-valuemin/max/now` + Arrow/Home/End/PageUp/Down keyboard; the track
 * is pointer-draggable (1:1, capture-based). Token-only, reduced-motion aware. Dumb island.
 */
export interface ZoomSliderProps {
	/** Current zoom (raw = uncontrolled; `Signal` = controlled). */
	value?: Bindable<number>;
	onValueChange?: (value: number) => void;
	min?: number;
	max?: number;
	/** Step for the ± buttons + Arrow keys (default `(max - min) / 10`). */
	step?: number;
	/** Number of segments the track is divided into → `segments + 1` tick markers (default `8`). */
	segments?: number;
	/** Position of the distinct centre "transition" marker (default the midpoint). */
	center?: number;
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

const MinusGlyph = (
	<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
		<path d="M3.5 8h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
	</svg>
);
const PlusGlyph = (
	<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
		<path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
	</svg>
);

export function ZoomSlider(props: ZoomSliderProps): JSX.Element {
	const {
		value,
		onValueChange,
		min = 0,
		max = 1,
		step = (max - min) / 10,
		segments = 8,
		center = (min + max) / 2,
		size = "sm",
		disabled,
		readOnly,
		formatValue,
		"aria-label": ariaLabel = "Zoom",
		class: className,
	} = props;

	/** Disabled blocks everything; read-only blocks the write but keeps focus and announcement. */
	const locked = Boolean(disabled || readOnly);

	const ctrl = useControllable<number>(value, clamp((min + max) / 2, min, max), onValueChange);
	const trackRef = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);

	const v = clamp(ctrl.signal.value, min, max);
	const pct = (n: number) => ((clamp(n, min, max) - min) / (max - min)) * 100;

	const setFromClientX = (clientX: number) => {
		const el = trackRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0) return;
		const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
		ctrl.set(min + ratio * (max - min));
	};

	const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (locked) return;
		dragging.current = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		setFromClientX(e.clientX);
	};
	const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		setFromClientX(e.clientX);
	};
	const onPointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (!dragging.current) return;
		dragging.current = false;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
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
		ctrl.set(clamp(next, min, max));
	};

	const ticks = Array.from({ length: segments + 1 }, (_, i) => (i / segments) * 100);

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
			<button
				type="button"
				class="ui-zoom__btn ui-hit"
				aria-label="Zoom out"
				disabled={locked}
				onClick={() => ctrl.set(clamp(v - step, min, max))}
			>
				{MinusGlyph}
			</button>

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
				onKeyDown={onKeyDown}
			>
				<div class="ui-zoom__rail" aria-hidden="true" />
				<div
					class="ui-zoom__fill"
					style={styleVars({ "--zoom-pct": `${pct(v)}%` })}
					aria-hidden="true"
				/>
				<div class="ui-zoom__ticks" aria-hidden="true">
					{ticks.map((t, i) => (
						<span key={i} class="ui-zoom__tick" style={styleVars({ "--tick": `${t}%` })} />
					))}
				</div>
				<span
					class="ui-zoom__center"
					style={styleVars({ "--tick": `${pct(center)}%` })}
					aria-hidden="true"
				/>
				<span
					class="ui-zoom__handle"
					style={styleVars({ "--zoom-pct": `${pct(v)}%` })}
					aria-hidden="true"
				/>
			</div>

			<button
				type="button"
				class="ui-zoom__btn ui-hit"
				aria-label="Zoom in"
				disabled={locked}
				onClick={() => ctrl.set(clamp(v + step, min, max))}
			>
				{PlusGlyph}
			</button>
		</div>
	);
}
