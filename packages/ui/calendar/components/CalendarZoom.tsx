/**
 * @projective/ui/calendar — the calendar's view control: a RULER across every view, and a toggle
 * between the calendar and the timeline.
 *
 * The ruler reads like a scale: Day at its inline start, then Week · Month on the calendar axis, and
 * on through Quarter · Year on the timeline — each stop a zone with its name above it, a major tick at
 * every boundary and a minor tick at every mini-stop inside. Only the active axis's stops are drawn:
 * the calendar has no Quarter or Year grid to show, and drawing one it cannot honour would be a stop
 * that refuses the reader.
 *
 * **Free while held, snapped on release.** The calendar tracks the pointer exactly while it is held —
 * nothing snaps under a moving hand. On release the value settles on the nearest mini-stop inside the
 * stop the hand let go in, and the engine springs the grid there (it publishes every frame, so the
 * marker rides the same spring rather than a CSS transition of its own). With `snap={false}` (the
 * reader's "Snap zoom to intervals" off) the release stays put; the keys step tick to tick either way.
 *
 * It is a `role="slider"` in its own right: arrows move one mini-stop, Page keys a whole stop, Home
 * and End the two ends; the active stop is the spoken value. In a right-to-left page the ruler
 * mirrors — Day at the right — and the arrows follow what the reader sees.
 */
import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/zoom.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Tooltip } from "../../feedback/mod.ts";
import { Button } from "../../fields/components/Button.tsx";
import type { FieldSize } from "../../fields/types/mod.ts";
import { Icon } from "../../icons/mod.ts";
import {
	type CalendarZoomMode,
	stopAt,
	stopsFor,
	ZOOM_STOP_LABEL,
	ZOOM_TICKS_PER_STOP,
} from "../core/zoom.ts";

/** Mini-stops per stop: the ruler's minor ticks, and the positions a snapped zoom settles on. */
export const RULER_TICKS_PER_STOP = ZOOM_TICKS_PER_STOP;

/** Props for {@link CalendarZoom}. */
export interface CalendarZoomProps {
	/** Which axis the ruler drives. */
	mode: CalendarZoomMode;
	/** The position along that axis: 0 is its widest view, 1 its deepest (`core/zoom.ts`). */
	value: number;
	onValueChange: (value: number) => void;
	/** Switch between the calendar and the timeline. Absent, no toggle is drawn. */
	onModeChange?: (mode: CalendarZoomMode) => void;
	/** Settle a released drag on a mini-stop. Default `true`; the keys always step tick to tick. */
	snap?: boolean;
	size?: FieldSize;
	class?: string;
}

function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function CalendarZoom(props: CalendarZoomProps): JSX.Element {
	const { mode } = props;
	const timeline = mode === "timeline";
	// Deepest first: the ruler reads Day → … → Month (calendar) or → Year (timeline).
	const stops = [...stopsFor(mode)].reverse();
	const n = stops.length;
	const steps = n * RULER_TICKS_PER_STOP;
	const rulerRef = useRef<HTMLDivElement>(null);
	/** The raw position under a held pointer; `null` at rest, when the marker shows the snapped value. */
	const held = useSignal<number | null>(null);

	const u = clamp01(held.value ?? props.value);
	/** Distance along the ruler from its Day end, 0..1 — the axis position read the other way round. */
	const along = 1 - u;
	const active = stopAt(mode, u);
	const snap = (v: number) => clamp01(Math.round(v * steps) / steps);
	/**
	 * The release's settle: the nearest mini-stop, kept inside the stop the hand let go in, so letting
	 * go never switches the view. A boundary tick belongs to the deeper stop; from below it is that
	 * stop's deep end instead (the 1e-6 is `core/zoom.ts`'s own edge offset).
	 */
	function settle(v: number): number {
		const zone = Math.min(n - 1, Math.floor(clamp01(v) * n));
		return zone === n - 1 ? snap(v) : Math.min(snap(v), (zone + 1) / n - 1e-6);
	}

	/** The hand moved: the calendar tracks it exactly, with no snapping until it lets go. */
	function emit(v: number): void {
		const next = clamp01(v);
		if (next !== props.value) props.onValueChange(next);
	}

	function atPointer(e: PointerEvent): number {
		const el = rulerRef.current;
		if (!el) return u;
		const r = el.getBoundingClientRect();
		const rtl = getComputedStyle(el).direction === "rtl";
		const x = rtl ? r.right - e.clientX : e.clientX - r.left;
		return 1 - clamp01(x / r.width);
	}

	function onPointerDown(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (e.button !== 0) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		e.currentTarget.focus();
		const v = atPointer(e);
		held.value = v;
		emit(v);
	}

	function onPointerMove(e: JSX.TargetedPointerEvent<HTMLDivElement>): void {
		if (held.value === null) return;
		const v = atPointer(e);
		held.value = v;
		emit(v);
	}

	function release(): void {
		const v = held.value;
		held.value = null;
		if (v === null || props.snap === false) return;
		const next = settle(v);
		if (next !== props.value) props.onValueChange(next);
	}

	function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
		const step = 1 / steps;
		// Positive moves toward the WIDE end — rightward in a left-to-right page, leftward in RTL.
		const toWide = (d: number) => snap(props.value - d);
		const next = e.key === "ArrowUp"
			? toWide(step)
			: e.key === "ArrowDown"
			? toWide(-step)
			: e.key === "ArrowRight"
			? toWide(rtl ? -step : step)
			: e.key === "ArrowLeft"
			? toWide(rtl ? step : -step)
			: e.key === "PageUp"
			? toWide(1 / n)
			: e.key === "PageDown"
			? toWide(-1 / n)
			: e.key === "Home"
			? 1
			: e.key === "End"
			? 0
			: null;
		if (next === null) return;
		e.preventDefault();
		if (next !== props.value) props.onValueChange(next);
	}

	const label = timeline ? "Timeline zoom" : "Calendar zoom";

	return (
		<div
			class={cx("cal-zoom", props.size && `cal-zoom--${props.size}`, props.class)}
			data-mode={mode}
		>
			{props.onModeChange
				? (
					<Tooltip content="Timeline view">
						<Button
							iconOnly
							rounded
							size="sm"
							variant="text"
							severity="secondary"
							class="cal-zoom__mode ui-hit"
							icon={<Icon name="timeline" size="sm" />}
							aria-label="Timeline view"
							aria-pressed={timeline ? "true" : "false"}
							onClick={() => props.onModeChange?.(timeline ? "calendar" : "timeline")}
						/>
					</Tooltip>
				)
				: null}
			<div
				ref={rulerRef}
				class="cal-zoom__ruler"
				role="slider"
				tabIndex={0}
				aria-label={label}
				aria-orientation="horizontal"
				aria-valuemin={0}
				aria-valuemax={steps}
				aria-valuenow={Math.round(along * steps)}
				aria-valuetext={`${ZOOM_STOP_LABEL[active]} view`}
				style={styleVars({ "--ruler-stops": n, "--ruler-at": along })}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={release}
				onPointerCancel={release}
				onLostPointerCapture={release}
				onKeyDown={onKeyDown}
			>
				<div class="cal-zoom__names" aria-hidden="true">
					{stops.map((s, i) => (
						<span
							key={s}
							class="cal-zoom__name"
							data-on={s === active ? "true" : undefined}
							style={styleVars({ "--tick-at": i / n })}
						>
							{ZOOM_STOP_LABEL[s]}
						</span>
					))}
				</div>
				<div class="cal-zoom__scale" aria-hidden="true">
					{Array.from({ length: steps + 1 }, (_, i) => (
						<span
							key={i}
							class="cal-zoom__tick"
							data-major={i % RULER_TICKS_PER_STOP === 0 ? "true" : undefined}
							style={styleVars({ "--tick-at": i / steps })}
						/>
					))}
					<span class="cal-zoom__marker" />
				</div>
			</div>
		</div>
	);
}
