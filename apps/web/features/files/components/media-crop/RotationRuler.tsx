import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import {
	dragRotation,
	keyRotation,
	rulerTicks,
	wheelRotation,
} from "../../core/media/rotation-ruler.ts";

/**
 * RotationRuler — the crop editor's infinite rotation control: a strip of degree ticks rolling under
 * a fixed needle. Drag it, scroll it (either axis) or use the arrow keys (Shift for 15°, Home for 0°);
 * it wraps through ±180° without a stop. One `role="slider"`, so it reads as a value on a scale.
 */
export interface RotationRulerProps {
	/** Degrees, clockwise, in `(-180, 180]`. */
	value: number;
	disabled?: boolean;
	onChange: (degrees: number) => void;
	/** Called with `true` while the strip is being dragged, and `false` on release. */
	onScrub?: (active: boolean) => void;
	"aria-label"?: string;
}

export function RotationRuler(props: RotationRulerProps): JSX.Element {
	const { value, disabled } = props;
	const halfWidth = useSignal(0);
	const scrubbing = useSignal(false);
	const trackRef = useRef<HTMLDivElement>(null);
	const pointer = useRef<{ id: number; x: number; theta: number } | null>(null);
	const latest = useRef(props);
	latest.current = props;

	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		const measure = () => {
			const w = el.getBoundingClientRect().width / 2;
			if (w !== halfWidth.peek()) halfWidth.value = w;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			const p = latest.current;
			if (p.disabled) return;
			e.preventDefault();
			p.onChange(wheelRotation(p.value, e.deltaX, e.deltaY, e.deltaMode));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	function setScrub(active: boolean): void {
		scrubbing.value = active;
		props.onScrub?.(active);
	}

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (disabled || e.button !== 0) return;
		e.preventDefault();
		e.currentTarget.focus();
		e.currentTarget.setPointerCapture(e.pointerId);
		pointer.current = { id: e.pointerId, x: e.clientX, theta: value };
		setScrub(true);
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const p = pointer.current;
		if (!p || p.id !== e.pointerId) return;
		const dx = e.clientX - p.x;
		if (dx === 0) return;
		p.x = e.clientX;
		p.theta = dragRotation(p.theta, dx);
		props.onChange(p.theta);
	}

	function onPointerUp(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		const p = pointer.current;
		if (!p || p.id !== e.pointerId) return;
		pointer.current = null;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		setScrub(false);
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		if (disabled) return;
		const next = keyRotation(value, e.key, e.shiftKey);
		if (next === null) return;
		e.preventDefault();
		props.onChange(next);
	}

	const shown = Math.round(value);
	const ticks = halfWidth.value > 0 ? rulerTicks(value, halfWidth.value) : [];

	return (
		<div
			ref={trackRef}
			class="pf-ruler"
			role="slider"
			tabIndex={disabled ? -1 : 0}
			aria-label={props["aria-label"] ?? "Rotation"}
			aria-valuemin={-180}
			aria-valuemax={180}
			aria-valuenow={shown}
			aria-valuetext={`${shown} degrees`}
			aria-disabled={disabled ? "true" : undefined}
			data-scrubbing={scrubbing.value ? "true" : undefined}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onKeyDown={onKeyDown}
		>
			<span class="pf-ruler__strip" aria-hidden="true">
				{ticks.map((t) => (
					<span
						key={t.key}
						class={`pf-ruler__tick pf-ruler__tick--${t.tier}`}
						style={`--pf-tick-x:${t.x}px`}
					>
						{t.label && <span class="pf-ruler__label">{t.label}</span>}
					</span>
				))}
			</span>
			<span class="pf-ruler__needle" aria-hidden="true" />
		</div>
	);
}
