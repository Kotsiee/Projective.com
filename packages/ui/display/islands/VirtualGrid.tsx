import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/virtual-grid.css";
import { useVirtualScroll } from "../../hooks/useVirtualScroll.ts";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

/**
 * VirtualGrid — a windowed, infinite-scroll GRID of stretch-to-fill cells. `useVirtualScroll` is
 * strictly 1D, so this composes it as a "1D-by-row window": it measures its own inline width (a
 * ResizeObserver), derives `columns = floor((width + gap) / (minColWidth + gap))`, virtualizes the ROW
 * count (`ceil(items / columns)`), and renders each in-window row as an absolutely-positioned CSS grid
 * slice of `columns` equal (`1fr`) cells. Only the visible rows (+ overscan) are ever in the DOM, so a
 * corpus of thousands of cards scrolls at 60fps. Scrolls in the window (`useWindow`) or its own
 * container (`scrollHeight`). Infinite scroll fires `onReachEnd` near the tail (append → the row count
 * grows → the trigger re-arms).
 *
 * Because cells stretch, their width is uniform per layout but varies with the container — so
 * `rowHeight` may be a **function of the computed cell width**, letting a square/aspect grid keep its
 * rows sized to the live cell width while virtualization stays exact (all rows share one height).
 *
 * §B.4: the viewport carries no border; separation is the grid gap alone. Dumb island: no data access.
 */
export interface VirtualGridProps<T> {
	/** The full backing collection (only the in-window slice renders). */
	items: T[];
	/** Renders one cell. */
	itemTemplate: (item: T, ctx: { index: number }) => VNode;
	/** Minimum cell width (px); columns pack to `floor((width + gap) / (minColWidth + gap))`. */
	minColWidth: number;
	/**
	 * Row height (px), or a function of the computed (stretched) cell width — e.g.
	 * `(w) => w + FOOTER` for a square thumbnail card with a fixed-height caption footer.
	 */
	rowHeight: number | ((cellWidth: number) => number);
	/** Gap between cells + rows (px, default `16`). */
	gap?: number;
	/** Scroll in the page/window instead of an own container. */
	useWindow?: boolean;
	/** Own-container block extent (mutually exclusive with `useWindow`). */
	scrollHeight?: string | number;
	/** Overscan rows each edge (default `3`). */
	overscan?: number;
	/** Fired near the tail to load the next page. */
	onReachEnd?: () => void;
	/** Tail loading affordance. */
	loading?: boolean;
	loadingTemplate?: () => VNode;
	/** Stable per-item key for the row cache (defaults to index). */
	getItemKey?: (item: T, index: number) => string | number;
	/** Rendered when `items` is empty. */
	emptyTemplate?: () => VNode;
	"aria-label"?: string;
	class?: string;
}

export function VirtualGrid<T>(props: VirtualGridProps<T>): JSX.Element {
	const {
		items,
		itemTemplate,
		minColWidth,
		rowHeight,
		gap = 16,
		useWindow = false,
		scrollHeight,
		overscan = 3,
		onReachEnd,
		loading,
		loadingTemplate,
		getItemKey,
		emptyTemplate,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const viewportRef = useRef<HTMLDivElement>(null);
	// The measured inline width of the viewport → the live column count.
	const width = useSignal(0);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width ?? el.clientWidth;
			if (w > 0) width.value = w;
		});
		ro.observe(el);
		width.value = el.clientWidth;
		return () => ro.disconnect();
	}, []);

	const columns = Math.max(1, Math.floor((width.value + gap) / (minColWidth + gap)) || 1);
	const rowCount = Math.ceil(items.length / columns);
	// The stretched cell width for the current layout (all cells in all rows share it), so a square
	// card's row height is exact and virtualization stays uniform.
	const cellWidth = columns > 0 ? (width.value - (columns - 1) * gap) / columns : minColWidth;
	const resolvedRowHeight = typeof rowHeight === "function" ? rowHeight(cellWidth) : rowHeight;

	const v = useVirtualScroll({
		count: rowCount,
		itemSize: resolvedRowHeight,
		overscan,
		parentRef: viewportRef,
		useWindow,
		onReachEnd,
		getItemKey: getItemKey
			? (rowIndex) => {
				const first = items[rowIndex * columns];
				return first ? getItemKey(first, rowIndex * columns) : rowIndex;
			}
			: undefined,
	});

	const isEmpty = items.length === 0;

	return (
		<div
			ref={viewportRef}
			class={cx(
				"ui-vgrid",
				useWindow ? "ui-vgrid--window" : "ui-vgrid--own",
				className,
			)}
			role="list"
			aria-label={ariaLabel}
			style={styleVars({
				"--vgrid-gap": `${gap}px`,
				"--vgrid-cols": String(columns),
				"--vgrid-scroll-h": scrollHeight !== undefined
					? (typeof scrollHeight === "number" ? `${scrollHeight}px` : scrollHeight)
					: undefined,
			})}
		>
			{isEmpty
				? (emptyTemplate ? emptyTemplate() : null)
				: (
					<div class="ui-vgrid__sizer" style={styleVars({ "--vgrid-total": `${v.totalSize}px` })}>
						{v.virtualItems.map((row) => {
							const start = row.index * columns;
							const slice = items.slice(start, start + columns);
							return (
								// Rows are a UNIFORM computed height (no `measureElement`): measuring would cache
								// an early zero-width row height and then override the correct itemSize after the
								// container measures — leaving rows short while cards overflow. `itemSize` is
								// authoritative for a fixed-size grid.
								<div
									key={row.index}
									class="ui-vgrid__row"
									style={styleVars({ "--v-start": `${row.start}px`, "--v-size": `${row.size}px` })}
								>
									{slice.map((item, i) => (
										<div
											key={getItemKey ? getItemKey(item, start + i) : start + i}
											class="ui-vgrid__cell"
											role="listitem"
										>
											{itemTemplate(item, { index: start + i })}
										</div>
									))}
								</div>
							);
						})}
					</div>
				)}
			{loading
				? (
					<div class="ui-vgrid__loader" aria-hidden="true">
						{loadingTemplate ? loadingTemplate() : <span class="ui-vgrid__spinner" />}
					</div>
				)
				: null}
		</div>
	);
}
