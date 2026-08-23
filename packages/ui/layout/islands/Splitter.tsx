import type { ComponentChildren, CSSProperties, HTMLAttributes, JSX, VNode } from "preact";
import { toChildArray } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/splitter.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { resolveSplitSizes } from "../core/split-sizes.ts";

export type SplitterLayout = "horizontal" | "vertical";

const ARROW_STEP = 5;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// #region SplitterPanel
export interface SplitterPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, "size"> {
	/**
	 * Seed size as a percentage of the split axis. Panels without an explicit `size` split the
	 * remainder evenly. Siblings are re-normalised to 100% on mount.
	 *
	 * A SEED, not a binding: once a gutter has been dragged the dragged ratio wins, and changing this
	 * prop does not move the pane. It is re-read only when the number of panes changes, because that
	 * is the one edit the stored ratio cannot survive — see the note in {@link Splitter}.
	 */
	size?: number;
	/** Minimum size in percentage points the gutter will not shrink this panel below (default `5`). */
	minSize?: number;
	/**
	 * Maximum size in percentage points the gutter will not grow this panel above (default `100`).
	 * Pair with `minSize` on both panes to enforce a hard structural ratio — e.g. a modal's large media
	 * workspace vs its small metadata panel — so a drag can never collapse either past its bound.
	 */
	maxSize?: number;
	children?: ComponentChildren;
}

/**
 * SplitterPanel — a single resizable pane inside a {@link Splitter}. Must be a direct child of
 * `Splitter`; its `size`/`minSize` props are read directly off the child `VNode` by the parent, so
 * this component itself only renders the pane's content wrapper.
 */
export function SplitterPanel(props: SplitterPanelProps): JSX.Element {
	const { children, class: className, size: _size, minSize: _minSize, maxSize: _maxSize, ...rest } =
		props;
	return (
		<div class={cx("ui-splitter__pane-content", className as string)} {...rest}>
			{children}
		</div>
	);
}
// #endregion

// #region Splitter
export interface SplitterProps {
	/** Split axis (default `horizontal` — panels sit side by side, gutters are vertical bars). */
	layout?: SplitterLayout;
	/** Persists panel sizes to `localStorage` under this key and restores them on mount. */
	stateKey?: string;
	/** Gutter thickness as a CSS length (default `8px`). */
	gutterSize?: string;
	id?: string;
	class?: string;
	style?: CSSProperties;
	/** {@link SplitterPanel} elements — two or more. */
	children: ComponentChildren;
}

/**
 * Splitter — a resizable split layout of N {@link SplitterPanel}s divided by draggable gutters.
 * Sizes are tracked as percentages of the split axis and driven onto each pane via the `--split-size`
 * custom property; a spring-eased `flex-basis` transition applies to keyboard-driven resizes and is
 * suppressed while actively dragging so the pointer tracks 1:1. Nest a `Splitter` inside a
 * `SplitterPanel` for nested layouts — no special wiring required.
 *
 * A caller may show or hide a pane between renders; the size array re-derives when the pane COUNT
 * changes and at no other time, so a dragged ratio survives everything except the edit that makes it
 * meaningless (see the note beside {@link SplitterPanelProps.size}).
 *
 * Keyboard: each gutter is `role="separator"` with `aria-orientation` + `aria-valuenow/min/max`;
 * Arrow keys resize by 5 points, Home/End snap to the panel's min/max bound.
 */
export function Splitter(props: SplitterProps): JSX.Element {
	const {
		layout = "horizontal",
		stateKey,
		gutterSize = "4px",
		id,
		class: className,
		style,
		children,
	} = props;

	const panels = toChildArray(children) as VNode<SplitterPanelProps>[];
	const count = panels.length;
	const mins = panels.map((p) => p.props.minSize ?? 5);
	const maxes = panels.map((p) => p.props.maxSize ?? 100);
	const storageKey = stateKey ? `ui-splitter.${stateKey}` : undefined;

	const seeds = panels.map((p) => p.props.size);

	/** The ratio stored for this layout, or `null`. Storage may be unavailable; that is not an error. */
	const readPersisted = (): number[] | null => {
		if (!storageKey || typeof localStorage === "undefined") return null;
		try {
			const raw = localStorage.getItem(storageKey);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as number[];
			return Array.isArray(parsed) ? parsed : null;
		} catch {
			return null;
		}
	};

	const sizes = useSignal<number[]>(resolveSplitSizes([], seeds, readPersisted));

	/*
	 * The live ratio is keyed to a pane COUNT, so a changed count is the one edit it cannot survive.
	 *
	 * `size` is a mount SEED rather than a binding — that is exactly what lets a drag outlive a
	 * re-render, and it stays that way. But a caller that shows or hides a pane (a modal's roster
	 * column, a picker's inspector) changes the array's LENGTH, and {@link resolveSplitSizes} is where
	 * that is dealt with, once, in a form that is tested rather than argued about.
	 *
	 * Re-derived during RENDER rather than in an effect, because the first paint after the count change
	 * is the one the reader sees and an effect lands a frame too late. Nothing is written here: the
	 * signal is the DRAG store and `persist` puts the right length back on the next drag, while the
	 * persisted array is left alone — so a ratio dragged at this count is still there after a round
	 * trip through a different one.
	 */
	const current = resolveSplitSizes(sizes.value, seeds, readPersisted);

	const isDragging = useSignal(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const drag = useRef<
		{ index: number; axisSize: number; startPos: number; a: number; b: number } | null
	>(
		null,
	);

	const persist = (next: number[]) => {
		sizes.value = next;
		if (storageKey && typeof localStorage !== "undefined") {
			try {
				localStorage.setItem(storageKey, JSON.stringify(next));
			} catch {
				/* storage unavailable — non-fatal */
			}
		}
	};

	/**
	 * Move the boundary between `index` and `index + 1` by `deltaPct`, clamped so BOTH neighbouring
	 * panes stay within their `[minSize, maxSize]` bounds — the hard structural ratio (e.g. modal media
	 * vs metadata). `da` is bounded below by `max(minA - a, b - maxB)` and above by `min(maxA - a,
	 * b - minB)`; the exchange conserves the pair's total, so no other pane is disturbed.
	 */
	const resizeBoundary = (index: number, a: number, b: number, deltaPct: number) => {
		const minA = mins[index];
		const minB = mins[index + 1];
		const maxA = maxes[index];
		const maxB = maxes[index + 1];
		const da = clamp(deltaPct, Math.max(minA - a, b - maxB), Math.min(maxA - a, b - minB));
		const next = current.slice();
		next[index] = a + da;
		next[index + 1] = b - da;
		persist(next);
	};

	// #region Pointer drag
	const onGutterPointerDown = (index: number) => (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const root = rootRef.current;
		if (!root) return;
		const rect = root.getBoundingClientRect();
		drag.current = {
			index,
			axisSize: layout === "horizontal" ? rect.width : rect.height,
			startPos: layout === "horizontal" ? e.clientX : e.clientY,
			a: current[index],
			b: current[index + 1],
		};
		isDragging.value = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};
	const onGutterPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.axisSize <= 0) return;
		const pos = layout === "horizontal" ? e.clientX : e.clientY;
		const deltaPct = ((pos - d.startPos) / d.axisSize) * 100;
		resizeBoundary(d.index, d.a, d.b, deltaPct);
	};
	const onGutterPointerUp = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
		if (drag.current) {
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
			drag.current = null;
			isDragging.value = false;
		}
	};
	// #endregion

	// #region Keyboard
	const onGutterKeyDown = (index: number) => (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const growKey = layout === "horizontal" ? "ArrowRight" : "ArrowDown";
		const shrinkKey = layout === "horizontal" ? "ArrowLeft" : "ArrowUp";
		const a = current[index];
		const b = current[index + 1];
		let delta = 0;
		if (e.key === growKey) delta = ARROW_STEP;
		else if (e.key === shrinkKey) delta = -ARROW_STEP;
		else if (e.key === "Home") delta = -1000;
		else if (e.key === "End") delta = 1000;
		else return;
		e.preventDefault();
		resizeBoundary(index, a, b, delta);
	};
	// #endregion

	const nodes: JSX.Element[] = [];
	for (let i = 0; i < count; i++) {
		nodes.push(
			<div
				key={`pane-${i}`}
				class="ui-splitter__pane"
				style={styleVars({ "--split-size": `${current[i]}%` })}
			>
				{panels[i]}
			</div>,
		);
		if (i < count - 1) {
			const minAfter = mins.slice(i + 1).reduce((s, m) => s + m, 0);
			nodes.push(
				<div
					key={`gutter-${i}`}
					class="ui-splitter__gutter"
					role="separator"
					aria-orientation={layout === "horizontal" ? "vertical" : "horizontal"}
					aria-label={`Resize ${layout === "horizontal" ? "column" : "row"} ${i + 1}`}
					aria-valuenow={Math.round(current[i])}
					aria-valuemin={mins[i]}
					aria-valuemax={Math.round(Math.min(maxes[i], 100 - minAfter))}
					tabIndex={0}
					onPointerDown={onGutterPointerDown(i)}
					onPointerMove={onGutterPointerMove}
					onPointerUp={onGutterPointerUp}
					onKeyDown={onGutterKeyDown(i)}
				>
					<span class="ui-splitter__grip" aria-hidden="true" />
				</div>,
			);
		}
	}

	return (
		<div
			ref={rootRef}
			id={id}
			class={cx(
				"ui-splitter",
				`ui-splitter--${layout}`,
				isDragging.value && "ui-splitter--dragging",
				className,
			)}
			style={styleVars({ "--split-gutter-size": gutterSize }, style)}
		>
			{nodes}
		</div>
	);
}
// #endregion
