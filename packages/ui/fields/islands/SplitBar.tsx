import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/split-bar.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { MetaLine } from "../../display/components/MetaLine.tsx";
import {
	boundaryAt,
	dragHandleTo,
	formatSplitPercent,
	handleLabel,
	handleRange,
	handleValueText,
	keyToSplit,
	SPLIT_TOTAL_BP,
	type SplitChangeSource,
	type SplitSegment,
} from "../core/split-bar-model.ts";

/**
 * SplitBar — a proportional basis-point slider: one shared rail, one segment per share, one handle
 * between each pair of neighbours.
 *
 * Dragging handle `i` trades basis points between segment `i` and `i + 1` only, so the whole always
 * stays exactly 100.00% by construction (`core/split-bar-model.ts` owns every number; this island only
 * translates pointer and key input into model calls). Held segments lock both of their handles, and
 * each segment's `min` is a floor its neighbour cannot push it below.
 *
 * ### Contract
 * - **Controlled.** `value` is the split; `onValueChange(next, source)` fires per pointer frame or key
 *   step, and `onCommit(next)` fires once on pointer release or key release — a consumer marks itself
 *   dirty on change and never saves per frame.
 * - **Every handle is a real slider.** `role="slider"`, `aria-valuemin/max/now` in percent (two
 *   decimals) for the LEFT neighbour's share, `aria-valuetext` naming both neighbours' shares, and full
 *   keyboard parity: arrows 1% (Shift 0.1%), PageUp/PageDown 10%, Home/End to the reachable ends.
 *   Escape during a drag restores the split from drag start.
 * - **Width is never animated**, and no segment gets a minimum visual width: a 1% share is 1% wide.
 * - Segments carry no text and no role; the MetaLine legend below is the readable record.
 */

// #region Props
export interface SplitBarProps {
	/** The split, in render order. Shares are integer basis points summing to 10 000. */
	value: readonly SplitSegment[];
	/** Fires on every pointer frame (`"drag"`) or key step (`"key"`) that changes the split. */
	onValueChange?: (next: readonly SplitSegment[], source: SplitChangeSource) => void;
	/** Fires once when a drag ends or a stepping key is released, with the settled split. */
	onCommit?: (next: readonly SplitSegment[]) => void;
	/**
	 * Categorical tone tokens, by custom-property name (`"--primary"`), cycled across segments. Default:
	 * the six `--split-bar-tone-*` ramp tones declared in split-bar.css.
	 */
	tones?: readonly string[];
	/** Read-only: handles stay focusable and announce their values but do not move. */
	readOnly?: boolean;
	/** Render the MetaLine legend below the rail (default `true`). */
	legend?: boolean;
	/** Accessible name for the whole control group. */
	"aria-label"?: string;
	id?: string;
	class?: string;
}
// #endregion

// #region Helpers
const DEFAULT_TONES: readonly string[] = [
	"--split-bar-tone-1",
	"--split-bar-tone-2",
	"--split-bar-tone-3",
	"--split-bar-tone-4",
	"--split-bar-tone-5",
	"--split-bar-tone-6",
];

const TOKEN_NAME = /^--[A-Za-z0-9-]+$/;

/** The `var()` reference for segment `index`, cycling the tone list; unsafe names fall back. */
function toneFor(tones: readonly string[], index: number): string {
	const name = tones.length > 0 ? tones[index % tones.length] : DEFAULT_TONES[0];
	return `var(${TOKEN_NAME.test(name) ? name : DEFAULT_TONES[index % DEFAULT_TONES.length]})`;
}

/** Basis points as a CSS percentage for the variable-mapping seam (`4250` → `"42.5%"`). */
function cssPercent(bp: number): string {
	return `${bp / 100}%`;
}
// #endregion

// #region Component
export function SplitBar(props: SplitBarProps): JSX.Element {
	const {
		value,
		tones = DEFAULT_TONES,
		readOnly = false,
		legend = true,
		"aria-label": ariaLabel,
		id,
		class: className,
	} = props;

	const trackRef = useRef<HTMLDivElement | null>(null);
	/** Index of the handle under an active pointer drag, or `null`. */
	const dragging = useSignal<number | null>(null);
	/** The split at drag start — Escape restores it, and release commits only if it changed. */
	const dragStart = useRef<readonly SplitSegment[] | null>(null);
	/** A key step changed the split since the last commit; the next key release commits it. */
	const keyPending = useRef(false);
	/** The element + pointer holding capture, so Escape can release it before the pointer lifts. */
	const capture = useRef<{ el: HTMLButtonElement; id: number } | null>(null);

	const emit = (next: readonly SplitSegment[], source: SplitChangeSource): void => {
		if (next !== value) props.onValueChange?.(next, source);
	};

	/** The boundary, in basis points from the track's inline-start edge, under `clientX`. */
	const boundaryAtPointer = (clientX: number): number | null => {
		const track = trackRef.current;
		if (!track) return null;
		const rect = track.getBoundingClientRect();
		if (rect.width <= 0) return null;
		const rtl = getComputedStyle(track).direction === "rtl";
		const fromStart = rtl ? rect.right - clientX : clientX - rect.left;
		return (fromStart / rect.width) * SPLIT_TOTAL_BP;
	};

	const endDrag = (
		event: JSX.TargetedPointerEvent<HTMLButtonElement>,
		commit: boolean,
	): void => {
		if (dragging.value === null) return;
		dragging.value = null;
		const start = dragStart.current;
		dragStart.current = null;
		capture.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (commit && start !== null && start !== value) props.onCommit?.(value);
	};

	const onPointerDown = (index: number) => (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
		if (readOnly || event.button !== 0 || handleRange(value, index).locked) return;
		dragging.value = index;
		dragStart.current = value;
		event.currentTarget.setPointerCapture(event.pointerId);
		capture.current = { el: event.currentTarget, id: event.pointerId };
		// Suppress text selection / native gestures without suppressing focus.
		event.preventDefault();
		event.currentTarget.focus();
	};

	const onPointerMove = (index: number) => (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
		if (dragging.value !== index) return;
		const boundary = boundaryAtPointer(event.clientX);
		if (boundary !== null) emit(dragHandleTo(value, index, boundary), "drag");
	};

	const onKeyDown = (index: number) => (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "Escape" && dragging.value !== null) {
			event.preventDefault();
			const start = dragStart.current;
			// Clearing the start first makes the release that follows a no-commit.
			dragStart.current = null;
			dragging.value = null;
			const captured = capture.current;
			capture.current = null;
			if (captured?.el.hasPointerCapture(captured.id)) {
				captured.el.releasePointerCapture(captured.id);
			}
			if (start !== null) emit(start, "drag");
			return;
		}
		if (readOnly) return;
		const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
		const next = keyToSplit(value, index, { key: event.key, shiftKey: event.shiftKey, rtl });
		if (next === null) return;
		event.preventDefault();
		if (next !== value) {
			keyPending.current = true;
			emit(next, "key");
		}
	};

	const onKeyUp = (): void => {
		if (!keyPending.current) return;
		keyPending.current = false;
		props.onCommit?.(value);
	};

	return (
		<div
			id={id}
			class={cx("ui-split-bar", readOnly && "ui-split-bar--readonly", className)}
			role="group"
			aria-label={ariaLabel}
		>
			<div class="ui-split-bar__track" ref={trackRef}>
				<div class="ui-split-bar__rail" aria-hidden="true">
					{value.map((segment, index) => (
						<div
							key={segment.key}
							class="ui-split-bar__seg"
							data-held={segment.held ? "true" : undefined}
							style={styleVars({
								"--split-bar-seg": cssPercent(segment.bp),
								"--split-bar-seg-tone": toneFor(tones, index),
							})}
						/>
					))}
				</div>
				{value.slice(0, -1).map((segment, index) => {
					const range = handleRange(value, index);
					return (
						<button
							key={`${segment.key}:${value[index + 1].key}`}
							type="button"
							role="slider"
							class={cx(
								"ui-split-bar__handle",
								dragging.value === index && "ui-split-bar__handle--dragging",
							)}
							style={styleVars({ "--split-bar-at": cssPercent(boundaryAt(value, index)) })}
							aria-orientation="horizontal"
							aria-label={handleLabel(value, index)}
							aria-valuemin={range.min / 100}
							aria-valuemax={range.max / 100}
							aria-valuenow={range.now / 100}
							aria-valuetext={handleValueText(value, index)}
							aria-readonly={readOnly ? "true" : undefined}
							aria-disabled={range.locked ? "true" : undefined}
							onPointerDown={onPointerDown(index)}
							onPointerMove={onPointerMove(index)}
							onPointerUp={(event) => endDrag(event, true)}
							onPointerCancel={(event) => endDrag(event, true)}
							onKeyDown={onKeyDown(index)}
							onKeyUp={onKeyUp}
						/>
					);
				})}
			</div>
			{legend && (
				<MetaLine
					class="ui-split-bar__legend"
					items={value.map((segment) => ({
						text: `${segment.label} ${formatSplitPercent(segment.bp)}`,
						tabular: true,
					}))}
				/>
			)}
		</div>
	);
}
// #endregion
