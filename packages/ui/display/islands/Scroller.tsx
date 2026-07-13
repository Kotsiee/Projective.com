import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/virtual-scroller.css";
import "../styles/scroller.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useVirtualScroll } from "../../hooks/useVirtualScroll.ts";
import type { VirtualScrollerOrientation, VirtualScrollerRange } from "./VirtualScroller.tsx";

// #region Types
/**
 * Content strategy:
 *  - `inline` (default) — Scroller renders each windowed item via `itemTemplate`.
 *  - `delegated` — Scroller reserves the geometry and hands the current window to `contentTemplate`,
 *    letting the caller own the row markup for advanced cases.
 */
export type ScrollerContentMode = "inline" | "delegated";

/** Imperative scroll-position API, populated on the ref passed via {@link ScrollerProps.handleRef}. */
export interface ScrollerHandle {
	/** Scroll a given item index to the start of the viewport. */
	scrollToIndex: (index: number) => void;
	/** The currently rendered window `{ first, last }`. */
	getRange: () => VirtualScrollerRange;
}

/** Position snapshot emitted by {@link ScrollerProps.onScrollPosition}. */
export interface ScrollerPosition {
	/** Index of the first rendered item. */
	firstIndex: number;
	/** Index of the last rendered item. */
	lastIndex: number;
}

/** Props for {@link Scroller}. */
export interface ScrollerProps<T> {
	/** The full dataset (grows as `step` chunks load). */
	items: T[];
	/** Fixed row extent (px) or a per-index estimate for variable rows. */
	itemSize: number | ((index: number) => number);
	/** Row renderer for `inline` mode. */
	itemTemplate?: (item: T, ctx: { index: number }) => VNode;
	/** Window renderer for `delegated` mode — receives the current range + its items. */
	contentTemplate?: (window: { items: T[]; range: VirtualScrollerRange }) => VNode;
	/** Content strategy (default `inline`). */
	mode?: ScrollerContentMode;
	/** Windowed axis (default `vertical`). */
	orientation?: VirtualScrollerOrientation;
	/** Own-container block extent. Mutually exclusive with `useWindow`. */
	scrollHeight?: string | number;
	/** Own-container inline extent for horizontal scrolling. */
	scrollWidth?: string | number;
	/** Use the page/window as the scroll source instead of an own scroll container. */
	useWindow?: boolean;
	/** Rows loaded per step; when set, `onLoadStep` fires at the tail with the next range to fetch. */
	step?: number;
	/** Called at the tail with the next `{ first, last }` chunk to load (paired with `step`). */
	onLoadStep?: (next: VirtualScrollerRange) => void;
	/** Show skeleton loader rows appended at the tail while a step loads. */
	loading?: boolean;
	/** Number of skeleton rows to show when `loading` (default 3). */
	loaderCount?: number;
	/** Custom skeleton/loader row; defaults to a shimmering token-styled bar. */
	loaderTemplate?: () => VNode;
	/** Rows rendered beyond each edge (default 4). */
	overscan?: number;
	/** Notified of the visible range whenever it moves. */
	onScrollPosition?: (pos: ScrollerPosition) => void;
	/** Receives the imperative {@link ScrollerHandle} once mounted. */
	handleRef?: { current: ScrollerHandle | null };
	/** Accessible label for the list region. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * Scroller — a flexible standalone virtual viewport: a VirtualScroller with extra knobs. Adds
 * inline vs delegated content modes, `step`-based tail loading with skeleton `loaderTemplate` rows,
 * a scroll-position callback, and an imperative `scrollToIndex` handle. Supports both its own scroll
 * container and page/window scroll. Exposes `role="list"` semantics with `role="listitem"` rows.
 */
export function Scroller<T>(props: ScrollerProps<T>): JSX.Element {
	const {
		items,
		itemSize,
		itemTemplate,
		contentTemplate,
		mode = "inline",
		orientation = "vertical",
		scrollHeight,
		scrollWidth,
		useWindow = false,
		step,
		onLoadStep,
		loading = false,
		loaderCount = 3,
		loaderTemplate,
		overscan = 4,
		onScrollPosition,
		handleRef,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const horizontal = orientation === "horizontal";
	const viewportRef = useRef<HTMLDivElement>(null);

	const reachEnd = () => {
		if (step === undefined || !onLoadStep) return;
		onLoadStep({ first: items.length, last: items.length + step - 1 });
	};

	const {
		virtualItems,
		totalSize,
		range,
		measureElement,
		scrollToIndex,
	} = useVirtualScroll({
		count: items.length,
		itemSize,
		overscan,
		horizontal,
		parentRef: viewportRef,
		useWindow,
		onReachEnd: reachEnd,
	});

	// #region Position + handle wiring
	useEffect(() => {
		onScrollPosition?.({ firstIndex: range.start, lastIndex: range.end });
	}, [onScrollPosition, range.start, range.end]);

	useEffect(() => {
		if (!handleRef) return;
		handleRef.current = {
			scrollToIndex,
			getRange: () => ({ first: range.start, last: range.end }),
		};
		return () => {
			handleRef.current = null;
		};
	}, [handleRef, scrollToIndex, range.start, range.end]);
	// #endregion

	const sizeToLength = (v: string | number | undefined): string | undefined =>
		v === undefined ? undefined : typeof v === "number" ? `${v}px` : v;

	const containerVars = styleVars({
		"--vs-height": sizeToLength(scrollHeight),
		"--vs-width": sizeToLength(scrollWidth),
		"--vs-total-block": horizontal ? undefined : `${totalSize}px`,
		"--vs-total-inline": horizontal ? `${totalSize}px` : undefined,
	});

	const windowItems = virtualItems
		.map((vi) => items[vi.index])
		.filter((it): it is T => it !== undefined);

	const renderSkeletonRow = () =>
		loaderTemplate ? loaderTemplate() : (
			<div class="ui-scroller__skeleton" aria-hidden="true">
				<span class="ui-scroller__skeleton-bar ui-scroller__skeleton-bar--full" />
				<span class="ui-scroller__skeleton-bar ui-scroller__skeleton-bar--short" />
			</div>
		);

	return (
		<div
			ref={viewportRef}
			class={cx(
				"ui-scroller",
				"ui-vscroll",
				useWindow ? "ui-vscroll--window" : "ui-vscroll--own",
				orientation === "horizontal" && "ui-vscroll--horizontal",
				orientation === "both" && "ui-vscroll--both",
				className,
			)}
			style={containerVars}
			role="list"
			aria-label={ariaLabel}
			aria-busy={loading || undefined}
		>
			<div class="ui-vscroll__sizer">
				{mode === "delegated" && contentTemplate
					? contentTemplate({ items: windowItems, range: { first: range.start, last: range.end } })
					: virtualItems.map((vi) => {
						const item = items[vi.index];
						if (item === undefined || !itemTemplate) return null;
						return (
							<div
								key={vi.index}
								class="ui-vscroll__item"
								role="listitem"
								data-index={vi.index}
								ref={measureElement}
								style={styleVars({
									"--v-start": `${vi.start}px`,
									"--v-size": `${vi.size}px`,
								})}
							>
								{itemTemplate(item, { index: vi.index })}
							</div>
						);
					})}
			</div>
			{loading && (
				<div class="ui-vscroll__loader" role="status" aria-live="polite">
					<div>
						{Array.from({ length: loaderCount }).map((_, i) => (
							<div key={i}>{renderSkeletonRow()}</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
