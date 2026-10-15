import type { JSX, VNode } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/virtual-grid.css";
import { useVirtualScroll } from "../../hooks/useVirtualScroll.ts";
import { cx } from "../../core/cx.ts";
import { prefersJumpToFinal } from "../../core/motion.ts";
import { styleVars } from "../../core/style.ts";

/**
 * How a {@link VirtualGrid} sizes its cells: `"stretch"` packs `minColWidth` columns and grows them
 * to fill the row; `"exact"` renders every cell at exactly `minColWidth` (capped at the viewport),
 * so a zoom-driven width scales the cards continuously instead of in column-count jumps.
 */
export type VirtualGridFit = "stretch" | "exact";

/**
 * VirtualGrid — a windowed, infinite-scroll GRID. `useVirtualScroll` is strictly 1D, so this composes
 * it as a "1D-by-row window": it measures its own inline width (a ResizeObserver), derives
 * `columns = floor((width + gap) / (minColWidth + gap))`, virtualizes the ROW count
 * (`ceil(items / columns)`), and places each in-window cell absolutely with a `transform`. Only the
 * visible rows (+ overscan) are ever in the DOM, so a corpus of thousands of cards scrolls at 60fps.
 * Scrolls in the window (`useWindow`) or its own container (`scrollHeight`). Infinite scroll fires
 * `onReachEnd` near the tail.
 *
 * Cells are keyed by item, not by row, so a card keeps its element when the column count changes:
 * the reflow glides each card from where it was to where it now sits (a transform-only FLIP on the
 * motion tokens, skipped under reduced motion), and the item at the top of the viewport stays put
 * while the rows rescale.
 *
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
	/** Cell width (px): the column floor under `"stretch"`, the exact width under `"exact"`. */
	minColWidth: number;
	/** How cells fill the row (default `"stretch"`). */
	fit?: VirtualGridFit;
	/**
	 * Row height (px), or a function of the computed cell width — e.g.
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
	/** Stable per-item key for the cell cache (defaults to index). */
	getItemKey?: (item: T, index: number) => string | number;
	/** Rendered when `items` is empty. */
	emptyTemplate?: () => VNode;
	"aria-label"?: string;
	class?: string;
}

interface GridGeometry {
	columns: number;
	cellWidth: number;
	rowHeight: number;
	gap: number;
}

const cellX = (index: number, g: GridGeometry) => (index % g.columns) * (g.cellWidth + g.gap);
const cellY = (index: number, g: GridGeometry) => Math.floor(index / g.columns) * g.rowHeight;

function motionReduced(): boolean {
	return prefersJumpToFinal() || document.documentElement.dataset.motion === "reduced";
}

function readTimeToken(el: Element, name: string): number {
	const raw = getComputedStyle(el).getPropertyValue(name).trim();
	const n = parseFloat(raw);
	if (!Number.isFinite(n)) return 0;
	return raw.endsWith("ms") ? n : n * 1000;
}

function currentTranslate(el: HTMLElement): { x: number; y: number } | null {
	const t = getComputedStyle(el).transform;
	if (!t || t === "none") return null;
	const m = new DOMMatrixReadOnly(t);
	return { x: m.m41, y: m.m42 };
}

export function VirtualGrid<T>(props: VirtualGridProps<T>): JSX.Element {
	const {
		items,
		itemTemplate,
		minColWidth,
		fit = "stretch",
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
	const width = useSignal(0);
	const geometry = useRef<GridGeometry | null>(null);

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

	const w = width.value;
	const exact = fit === "exact";
	const target = exact && w > 0 ? Math.min(minColWidth, w) : minColWidth;
	const columns = Math.max(1, Math.floor((w + gap) / (target + gap)) || 1);
	const rowCount = Math.ceil(items.length / columns);
	const cellWidth = exact ? target : (w - (columns - 1) * gap) / columns;
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

	useLayoutEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const prev = geometry.current;
		const listTop = useWindow ? el.getBoundingClientRect().top + globalThis.scrollY : 0;
		const readScroll = () => useWindow ? globalThis.scrollY - listTop : el.scrollTop;
		const before = readScroll();
		const next: GridGeometry = { columns, cellWidth, rowHeight: resolvedRowHeight, gap };
		geometry.current = next;
		if (!prev || w <= 0 || prev.rowHeight <= 0 || resolvedRowHeight <= 0) return;
		const reflowed = prev.columns !== columns;
		if (!reflowed && prev.rowHeight === resolvedRowHeight && prev.cellWidth === cellWidth) return;

		let after = before;
		if (before > 0) {
			const rowPos = before / prev.rowHeight;
			const firstRow = Math.floor(rowPos);
			const anchored = (Math.floor((firstRow * prev.columns) / columns) + rowPos - firstRow) *
				resolvedRowHeight;
			if (Math.abs(anchored - before) >= 0.5) {
				if (useWindow) globalThis.scrollTo(globalThis.scrollX, listTop + anchored);
				else el.scrollTop = anchored;
				after = readScroll();
			}
		}

		if (!reflowed || motionReduced()) return;
		const duration = readTimeToken(el, "--dur-medium");
		if (duration <= 0) return;
		const easing = getComputedStyle(el).getPropertyValue("--ease-standard").trim() || "ease";
		const dir = getComputedStyle(el).direction === "rtl" ? -1 : 1;
		const shift = after - before;
		for (const cell of el.querySelectorAll<HTMLElement>(".ui-vgrid__cell")) {
			const index = Number(cell.dataset.index);
			if (!Number.isFinite(index)) continue;
			const live = cell.getAnimations().length > 0 ? currentTranslate(cell) : null;
			for (const a of cell.getAnimations()) a.cancel();
			const fromX = live ? live.x : cellX(index, prev) * dir;
			const fromY = (live ? live.y : cellY(index, prev)) + shift;
			const toX = cellX(index, next) * dir;
			const toY = cellY(index, next);
			if (Math.abs(fromX - toX) < 0.5 && Math.abs(fromY - toY) < 0.5) continue;
			cell.animate(
				[
					{ transform: `translate(${fromX}px, ${fromY}px)` },
					{ transform: `translate(${toX}px, ${toY}px)` },
				],
				{ duration, easing },
			);
		}
	}, [columns, cellWidth, resolvedRowHeight, gap, w]);

	const isEmpty = items.length === 0;
	const cellHeight = Math.max(0, resolvedRowHeight - gap);

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
				"--vgrid-cell-w": `${cellWidth}px`,
				"--vgrid-cell-h": `${cellHeight}px`,
				"--vgrid-scroll-h": scrollHeight !== undefined
					? (typeof scrollHeight === "number" ? `${scrollHeight}px` : scrollHeight)
					: undefined,
			})}
		>
			{isEmpty
				? (emptyTemplate ? emptyTemplate() : null)
				: (
					<div class="ui-vgrid__sizer" style={styleVars({ "--vgrid-total": `${v.totalSize}px` })}>
						{v.virtualItems.flatMap((row) => {
							const start = row.index * columns;
							return items.slice(start, start + columns).map((item, i) => {
								const index = start + i;
								return (
									<div
										key={getItemKey ? getItemKey(item, index) : index}
										class="ui-vgrid__cell"
										role="listitem"
										data-index={index}
										style={styleVars({
											"--c-x": `${i * (cellWidth + gap)}px`,
											"--c-y": `${row.start}px`,
										})}
									>
										{itemTemplate(item, { index })}
									</div>
								);
							});
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
