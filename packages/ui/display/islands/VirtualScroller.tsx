import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/virtual-scroller.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useVirtualScroll } from "../../hooks/useVirtualScroll.ts";

// #region Types
/**
 * Orientation of the windowed axis. `vertical` (default) and `horizontal` window a single axis;
 * `both` windows the block axis while letting wide rows scroll freely on the inline axis (true 2D
 * tiling is a grid concern — see {@link DataView}).
 */
export type VirtualScrollerOrientation = "vertical" | "horizontal" | "both";

/** The visible window reported to {@link VirtualScrollerProps.onLazyLoad} as the range moves. */
export interface VirtualScrollerRange {
	/** Index of the first rendered item (including overscan). */
	first: number;
	/** Index of the last rendered item (including overscan). */
	last: number;
}

/** Render context handed to {@link VirtualScrollerProps.itemTemplate}. */
export interface VirtualScrollerItemContext {
	/** Absolute index of the item within `items`. */
	index: number;
}

/** Props for {@link VirtualScroller}. */
export interface VirtualScrollerProps<T> {
	/** The full, potentially unbounded dataset. Only the visible window is rendered. */
	items: T[];
	/** Fixed row extent (px) or a per-index estimate for variable rows (measured at runtime). */
	itemSize: number | ((index: number) => number);
	/** Renders one item; receives the item and its `{ index }`. */
	itemTemplate: (item: T, ctx: VirtualScrollerItemContext) => VNode;
	/** Windowed axis (default `vertical`). */
	orientation?: VirtualScrollerOrientation;
	/** Own-container block extent (any CSS length). Mutually exclusive with `useWindow`. */
	scrollHeight?: string | number;
	/** Own-container inline extent (any CSS length) for horizontal scrolling. */
	scrollWidth?: string | number;
	/** Use the page/window as the scroll source instead of an own scroll container. */
	useWindow?: boolean;
	/** Emit {@link onLazyLoad} whenever the rendered range changes (chunked/lazy data loading). */
	lazy?: boolean;
	/** Called with the current window whenever it moves (only when `lazy`). */
	onLazyLoad?: (range: VirtualScrollerRange) => void;
	/** Show the loading affordance pinned to the tail (e.g. during an infinite fetch). */
	loading?: boolean;
	/** Custom loading indicator; defaults to a token-styled spinner. */
	loadingTemplate?: () => VNode;
	/** Rows rendered beyond each edge to smooth fast scrolling (default 4). */
	overscan?: number;
	/** Fired once when the tail scrolls into view — the infinite-scroll trigger. */
	onReachEnd?: () => void;
	/** Accessible label for the list region. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * VirtualScroller — high-performance windowed renderer for an unbounded `items` array, and the
 * reusable virtualization primitive other collections wrap. Renders only the rows intersecting the
 * viewport (plus overscan) as absolutely-positioned children over a full-height sizer, so DOM cost
 * stays fixed regardless of dataset size. Supports its own scroll container (`scrollHeight` /
 * `scrollWidth`) or page scroll (`useWindow`), fixed or variable item sizes, lazy range reporting,
 * and an `onReachEnd` infinite-scroll trigger. Exposes `role="list"` with `role="listitem"` rows.
 */
export function VirtualScroller<T>(props: VirtualScrollerProps<T>): JSX.Element {
	const {
		items,
		itemSize,
		itemTemplate,
		orientation = "vertical",
		scrollHeight,
		scrollWidth,
		useWindow = false,
		lazy = false,
		onLazyLoad,
		loading = false,
		loadingTemplate,
		overscan = 4,
		onReachEnd,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const horizontal = orientation === "horizontal";
	const viewportRef = useRef<HTMLDivElement>(null);

	const {
		virtualItems,
		totalSize,
		range,
		measureElement,
	} = useVirtualScroll({
		count: items.length,
		itemSize,
		overscan,
		horizontal,
		parentRef: viewportRef,
		useWindow,
		onReachEnd,
	});

	// #region Lazy range reporting
	useEffect(() => {
		if (!lazy || !onLazyLoad) return;
		onLazyLoad({ first: range.start, last: range.end });
	}, [lazy, onLazyLoad, range.start, range.end]);
	// #endregion

	const sizeToLength = (v: string | number | undefined): string | undefined =>
		v === undefined ? undefined : typeof v === "number" ? `${v}px` : v;

	const containerVars = styleVars({
		"--vs-height": sizeToLength(scrollHeight),
		"--vs-width": sizeToLength(scrollWidth),
		"--vs-total-block": horizontal ? undefined : `${totalSize}px`,
		"--vs-total-inline": horizontal ? `${totalSize}px` : undefined,
	});

	return (
		<div
			ref={viewportRef}
			class={cx(
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
				{virtualItems.map((vi) => {
					const item = items[vi.index];
					if (item === undefined) return null;
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
					{loadingTemplate
						? loadingTemplate()
						: <span class="ui-vscroll__spinner" aria-hidden="true" />}
				</div>
			)}
		</div>
	);
}
