import type { JSX, VNode } from "preact";
import { useMemo } from "preact/hooks";
import "../styles/dataview.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useId } from "../../hooks/useId.ts";
import { getFieldValue, sortRows } from "../core/collection.ts";
import { VirtualScroller } from "./VirtualScroller.tsx";
import type { Bindable } from "../../fields/types/mod.ts";
import type { LazyLoadEvent, SortDir, SortState } from "../../types/mod.ts";

// #region Types
/** Item layout mode. */
export type DataViewLayout = "list" | "grid";

/** A selectable sort option surfaced in the sort dropdown. */
export interface DataViewSortOption {
	/** Human label shown in the dropdown. */
	label: string;
	/** Row field path this option sorts by. */
	field: string;
	/** Sort direction applied when chosen (default `asc`). */
	order?: Exclude<SortDir, null>;
}

/** Props for {@link DataView}. */
export interface DataViewProps<T> {
	/** The current data. In `lazy` mode this is only the current page/window. */
	value: T[];
	/** Renders one item for the active `layout` (falls back to this in grid when no `gridItemTemplate`). */
	itemTemplate: (item: T, layout: DataViewLayout) => VNode;
	/** Dedicated grid-cell renderer; when omitted, `itemTemplate(item, "grid")` is used. */
	gridItemTemplate?: (item: T) => VNode;
	/** Active layout — bound value; a header toggle flips it. */
	layout?: Bindable<DataViewLayout>;
	/** Fired when the layout toggle changes. */
	onLayoutChange?: (layout: DataViewLayout) => void;
	/** Stable key read off each item for list keys (falls back to index). */
	dataKey?: string;
	/** Sort options rendered as a dropdown; selecting one sets `sortField`/`sortOrder`. */
	sortOptions?: DataViewSortOption[];
	/** Bound active sort field. */
	sortField?: Bindable<string>;
	/** Bound active sort direction. */
	sortOrder?: Bindable<SortDir>;
	/** Fired when the sort selection changes. */
	onSortChange?: (sort: SortState) => void;
	/** Render a pager and slice the data into pages. */
	paginator?: boolean;
	/** Page size (default 12). */
	rows?: number;
	/** Bound index of the first record on the active page. */
	first?: Bindable<number>;
	/** Total record count — required in `lazy` mode for correct page counts. */
	totalRecords?: number;
	/** Server-driven mode: the parent owns paging/sorting; DataView only emits `onLazyLoad`. */
	lazy?: boolean;
	/** Emitted in `lazy` mode whenever page/sort changes. */
	onLazyLoad?: (event: LazyLoadEvent) => void;
	/** Virtualize the list instead of paginating (mutually exclusive with `paginator`). */
	virtualScroll?: boolean;
	/** Row extent (px) for the virtual list. */
	virtualItemSize?: number;
	/** Own-container height for the virtual list. */
	scrollHeight?: string | number;
	/** Use page/window scroll for the virtual list. */
	useWindow?: boolean;
	/** Minimum grid column width (default `16rem`) — feeds `auto-fill`. */
	gridMinWidth?: string;
	/** Rendered when there are no records. */
	emptyTemplate?: () => VNode;
	/** Header content (left of the controls) — e.g. a title or count. */
	headerTemplate?: () => VNode;
	/** Footer content below the paginator. */
	footerTemplate?: () => VNode;
	/** Accessible label for the collection. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * DataView — a paginated or virtualized collection with a list⇄grid layout toggle, a sort dropdown,
 * and render-prop item templates. Client mode sorts + pages `value` locally; `lazy` mode delegates
 * paging/sorting to the parent via `onLazyLoad`. In `virtualScroll` mode the body is windowed by
 * {@link VirtualScroller} (own-container or `useWindow` page scroll). The grid reflows responsively
 * via `auto-fill`. Layout/sort/page are all signal-bindable. Exposes list semantics + a labelled
 * pager.
 */
export function DataView<T>(props: DataViewProps<T>): JSX.Element {
	const {
		value,
		itemTemplate,
		gridItemTemplate,
		layout,
		onLayoutChange,
		dataKey,
		sortOptions,
		sortField,
		sortOrder,
		onSortChange,
		paginator = false,
		rows = 12,
		first,
		totalRecords,
		lazy = false,
		onLazyLoad,
		virtualScroll = false,
		virtualItemSize = 88,
		scrollHeight,
		useWindow = false,
		gridMinWidth = "16rem",
		emptyTemplate,
		headerTemplate,
		footerTemplate,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const layoutCtrl = useControllable<DataViewLayout>(layout, "list", onLayoutChange);
	const fieldCtrl = useControllable<string>(sortField, "");
	const orderCtrl = useControllable<SortDir>(sortOrder, null);
	const firstCtrl = useControllable<number>(first, 0);
	const rootId = useId(undefined, "dataview");

	const activeLayout = layoutCtrl.signal.value;
	const activeField = fieldCtrl.signal.value;
	const activeOrder = orderCtrl.signal.value;
	const activeFirst = firstCtrl.signal.value;

	// #region Sort + page derivation (client mode)
	const sorted = useMemo(() => {
		if (lazy || !activeField || !activeOrder) return value;
		return sortRows(value, [{ field: activeField, dir: activeOrder }]);
	}, [value, lazy, activeField, activeOrder]);

	const total = totalRecords ?? sorted.length;

	const pageItems = useMemo(() => {
		if (lazy || !paginator || virtualScroll) return sorted;
		return sorted.slice(activeFirst, activeFirst + rows);
	}, [sorted, lazy, paginator, virtualScroll, activeFirst, rows]);
	// #endregion

	// #region Handlers
	const emitLazy = (nextFirst: number, sort: SortState) => {
		onLazyLoad?.({ first: nextFirst, last: nextFirst + rows, rows, sort });
	};

	const onSelectSort = (e: JSX.TargetedEvent<HTMLSelectElement>) => {
		const opt = sortOptions?.[Number(e.currentTarget.value)];
		const dir: SortDir = opt ? (opt.order ?? "asc") : null;
		const field = opt?.field ?? "";
		fieldCtrl.set(field);
		orderCtrl.set(dir);
		onSortChange?.({ field, dir });
		if (lazy) emitLazy(0, { field, dir });
		firstCtrl.set(0);
	};

	const goToPage = (page: number) => {
		const nextFirst = page * rows;
		firstCtrl.set(nextFirst);
		if (lazy) emitLazy(nextFirst, { field: activeField, dir: activeOrder });
	};

	const setLayout = (next: DataViewLayout) => layoutCtrl.set(next);
	// #endregion

	const pageCount = Math.max(1, Math.ceil(total / rows));
	const currentPage = Math.floor(activeFirst / rows);
	const isGrid = activeLayout === "grid";
	const isEmpty = (lazy ? value.length : sorted.length) === 0;

	const keyOf = (item: T, index: number): string | number =>
		dataKey ? String(getFieldValue(item, dataKey) ?? index) : index;

	const renderItem = (item: T): VNode =>
		isGrid
			? (gridItemTemplate ? gridItemTemplate(item) : itemTemplate(item, "grid"))
			: itemTemplate(item, "list");

	// #region Body
	const body = () => {
		if (isEmpty) {
			return (
				<div class="ui-dataview__empty" role="status">
					{emptyTemplate ? emptyTemplate() : "No records found."}
				</div>
			);
		}
		if (virtualScroll && !isGrid) {
			return (
				<VirtualScroller
					items={sorted}
					itemSize={virtualItemSize}
					useWindow={useWindow}
					scrollHeight={scrollHeight}
					aria-label={ariaLabel}
					itemTemplate={(item) => <div class="ui-dataview__item">{renderItem(item)}</div>}
				/>
			);
		}
		return (
			<div
				class={cx(isGrid ? "ui-dataview__grid" : "ui-dataview__list")}
				role="list"
				aria-label={ariaLabel}
			>
				{pageItems.map((item, i) => (
					<div key={keyOf(item, i)} class="ui-dataview__item" role="listitem">
						{renderItem(item)}
					</div>
				))}
			</div>
		);
	};
	// #endregion

	// #region Paginator
	const pager = () => {
		if (!paginator || virtualScroll) return null;
		const pages = Array.from({ length: pageCount }, (_, i) => i);
		return (
			<nav class="ui-dataview__paginator" aria-label="Pagination">
				<button
					type="button"
					class="ui-dataview__page"
					disabled={currentPage <= 0}
					aria-label="Previous page"
					onClick={() => goToPage(currentPage - 1)}
				>
					‹
				</button>
				{pages.map((p) => (
					<button
						key={p}
						type="button"
						class="ui-dataview__page"
						aria-current={p === currentPage ? "true" : undefined}
						aria-label={`Page ${p + 1}`}
						onClick={() => goToPage(p)}
					>
						{p + 1}
					</button>
				))}
				<button
					type="button"
					class="ui-dataview__page"
					disabled={currentPage >= pageCount - 1}
					aria-label="Next page"
					onClick={() => goToPage(currentPage + 1)}
				>
					›
				</button>
				<span class="ui-dataview__page-info">{total} items</span>
			</nav>
		);
	};
	// #endregion

	const selectedSortIndex = sortOptions?.findIndex(
		(o) => o.field === activeField && (o.order ?? "asc") === activeOrder,
	);

	return (
		<section
			class={cx("ui-dataview", className)}
			style={styleVars({ "--dv-grid-min": gridMinWidth })}
			aria-label={ariaLabel}
		>
			<header class="ui-dataview__header">
				<div class="ui-dataview__header-lead">{headerTemplate?.()}</div>
				<div class="ui-dataview__controls">
					{sortOptions && sortOptions.length > 0 && (
						<select
							class="ui-dataview__sort"
							aria-label="Sort by"
							value={selectedSortIndex !== undefined && selectedSortIndex >= 0
								? String(selectedSortIndex)
								: ""}
							onChange={onSelectSort}
						>
							<option value="">Sort by…</option>
							{sortOptions.map((o, i) => (
								<option key={o.field + (o.order ?? "asc")} value={String(i)}>{o.label}</option>
							))}
						</select>
					)}
					<div class="ui-dataview__toggle" role="group" aria-label="Layout">
						<button
							type="button"
							class="ui-dataview__toggle-btn"
							aria-pressed={!isGrid}
							aria-label="List layout"
							onClick={() => setLayout("list")}
						>
							☰
						</button>
						<button
							type="button"
							class="ui-dataview__toggle-btn"
							aria-pressed={isGrid}
							aria-label="Grid layout"
							onClick={() => setLayout("grid")}
						>
							▦
						</button>
					</div>
				</div>
			</header>
			<div class="ui-dataview__body" id={rootId}>{body()}</div>
			{pager()}
			{footerTemplate && <footer class="ui-dataview__footer">{footerTemplate()}</footer>}
		</section>
	);
}
