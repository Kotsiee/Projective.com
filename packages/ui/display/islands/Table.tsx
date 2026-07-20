import type { JSX, VNode } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/table.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import { useVirtualScroll } from "../../hooks/useVirtualScroll.ts";
import type {
	FilterConstraint,
	FilterMatchMode,
	LazyLoadEvent,
	SortState,
} from "../../types/mod.ts";
import {
	filterRows,
	getFieldValue,
	loadState,
	nextSortDir,
	saveState,
	sortRows,
	toText,
} from "../core/collection.ts";
import type { TableColumn } from "../types/mod.ts";

export type { TableColumn };

// #region Props
/** Row selection mode. `null` disables selection. */
export type TableSelectionMode = "single" | "multiple" | null;

/** Serialisable slice of table state persisted under `stateKey`. */
interface PersistedTableState {
	sorts: SortState[];
	filters: Record<string, FilterConstraint>;
	order: string[];
	widths: Record<string, number>;
	selection: string[];
}

/**
 * Props for {@link Table} — the generic DataTable. Every collection capability is opt-in so an
 * unconfigured table is a plain sticky-header grid.
 *
 * @typeParam T The row payload type.
 */
export interface TableProps<T> {
	/** Row data. In `lazy` mode this is only the current window; `totalRecords` gives the full count. */
	value: T[];
	/** Column descriptors, in initial display order. */
	columns: TableColumn<T>[];
	/** Stable row identity: a field name or a function. Falls back to the row index (avoid for selection). */
	dataKey?: string | ((row: T) => string);
	/** `single` (shift adds columns) or `multiple` (each click toggles a column) sort strategy. */
	sortMode?: "single" | "multiple";
	/**
	 * Allow more than one column to be sorted at once. Default `true`. When `false`, Shift-click is
	 * ignored and `sortMode` is treated as single-column — the table still cycles asc → desc → none,
	 * but only ever one active sort. Set `false` for surfaces (e.g. Files/Submissions) that want a
	 * single sort key while keeping the capability available for other tables.
	 */
	multiSort?: boolean;
	/** Selection strategy; pair with `selectionColumn` for a checkbox column. */
	selectionMode?: TableSelectionMode;
	/** Render a leading checkbox column (implies multiple selection affordance). */
	selectionColumn?: boolean;
	/** Fired with the full selected-row set whenever selection changes. */
	onSelectionChange?: (rows: T[]) => void;
	/** Render expandable detail for a row; a toggle column appears when set. */
	expandedRowTemplate?: (row: T) => VNode;
	/** Group consecutive rows by this field, emitting a spanning group-header row. */
	groupField?: string;
	/** Window the body — only visible rows are in the DOM (needs `virtualRowHeight`). */
	virtualScroll?: boolean;
	/** Estimated/fixed row height in px for the windowed renderer (default 44). */
	virtualRowHeight?: number;
	/** Body scroll container height, or `"flex"` to fill the parent. Ignored when `useWindow`. */
	scrollHeight?: string | "flex";
	/** Virtualize against the page scroll instead of an inner container. */
	useWindow?: boolean;
	/** Defer sort/filter/page/scroll to the server via `onLazyLoad`; `value` is shown verbatim. */
	lazy?: boolean;
	/** Lazy-mode data request (sort/filter/page/scroll). */
	onLazyLoad?: (event: LazyLoadEvent) => void;
	/** Total server-side record count (drives `aria-rowcount` + paginator in `lazy` mode). */
	totalRecords?: number;
	/** Show the loading overlay / `loadingTemplate`. */
	loading?: boolean;
	/** Persist sort/filter/column-order/widths/selection to localStorage under this key. */
	stateKey?: string;
	/** Enable the pagination footer. */
	paginator?: boolean;
	/** Rows per page (default 10). */
	rows?: number;
	/** Zero-based index of the first visible row (uncontrolled initial value). */
	first?: number;
	/** Fired on page change with the new first-row index + page size. */
	onPage?: (first: number, rows: number) => void;
	/** Per-row class hook for conditional styling. */
	rowClass?: (row: T) => string | undefined;
	/** Per-cell class hook for conditional styling. */
	cellClass?: (row: T, column: TableColumn<T>) => string | undefined;
	/** Content shown when there are no rows. */
	emptyTemplate?: () => VNode | string;
	/** Overlay shown while `loading`. */
	loadingTemplate?: () => VNode | string;
	/** Optional caption/toolbar rendered above the grid. */
	header?: VNode | string;
	/** Optional footer rendered below the grid (above the paginator). */
	footer?: VNode | string;
	/** Accessible name for the grid. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Row-key + display-row model
type DisplayRow<T> =
	| { kind: "group"; key: string; label: string }
	| { kind: "data"; key: string; row: T; index: number }
	| { kind: "expansion"; key: string; row: T };

function keyFactory<T>(dataKey: TableProps<T>["dataKey"]): (row: T, index: number) => string {
	if (typeof dataKey === "function") return (row) => dataKey(row);
	if (typeof dataKey === "string") return (row) => toText(getFieldValue(row, dataKey));
	return (_row, index) => `row-${index}`;
}
// #endregion

/**
 * Table — a generic, signal-first DataTable over `T[]`. Supports single/multi-column sorting
 * (`aria-sort`), a per-column filter row, single/multiple row selection with an optional checkbox
 * column, row expansion, column resize + reorder, row grouping, conditional styling, pagination,
 * lazy loading, localStorage state persistence and body virtualization against either an inner
 * container or the page (`useWindow`).
 *
 * Keyboard: header Enter/Space sorts (Shift adds a column in `single` mode); a focused row toggles
 * selection with Space/Enter; resize handles nudge width with Arrow keys. ARIA: `role="table"` with
 * `row`/`columnheader`/`cell` descendants, `aria-sort`, `aria-selected`, and `aria-rowcount` when
 * lazy.
 */
export function Table<T>(props: TableProps<T>): JSX.Element {
	const {
		value,
		columns,
		dataKey,
		sortMode = "single",
		multiSort = true,
		selectionMode = null,
		selectionColumn = false,
		onSelectionChange,
		expandedRowTemplate,
		groupField,
		virtualScroll = false,
		virtualRowHeight = 44,
		scrollHeight,
		useWindow = false,
		lazy = false,
		onLazyLoad,
		totalRecords,
		loading = false,
		stateKey,
		paginator = false,
		rows: pageSize = 10,
		first: firstProp = 0,
		onPage,
		rowClass,
		cellClass,
		emptyTemplate,
		loadingTemplate,
		header,
		footer,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const rootId = useId(undefined, "table");
	const getKey = useMemo(() => keyFactory(dataKey), [dataKey]);

	// #region State signals
	const persisted = useMemo(() => loadState<PersistedTableState>(stateKey), [stateKey]);
	const sorts = useSignal<SortState[]>(persisted?.sorts ?? []);
	const filters = useSignal<Record<string, FilterConstraint>>(persisted?.filters ?? {});
	const columnOrder = useSignal<string[]>(persisted?.order ?? columns.map((c) => c.field));
	const columnWidths = useSignal<Record<string, number>>(persisted?.widths ?? {});
	const selectedKeys = useSignal<Set<string>>(new Set(persisted?.selection ?? []));
	const expandedKeys = useSignal<Set<string>>(new Set());
	const first = useSignal<number>(firstProp);
	const dragField = useSignal<string | null>(null);
	// #endregion

	const parentRef = useRef<HTMLDivElement>(null);

	// #region Ordered columns
	const orderedColumns = useComputed<TableColumn<T>[]>(() => {
		const byField = new Map(columns.map((c) => [c.field, c]));
		const ordered: TableColumn<T>[] = [];
		for (const f of columnOrder.value) {
			const c = byField.get(f);
			if (c) ordered.push(c);
		}
		// Append any columns not yet in the persisted order.
		for (const c of columns) if (!columnOrder.value.includes(c.field)) ordered.push(c);
		return ordered;
	});
	// #endregion

	// #region Data pipeline (client mode)
	const processed = useComputed<T[]>(() => {
		if (lazy) return value;
		const filtered = filterRows(value, filters.value, getFieldValue);
		return sortRows(filtered, sorts.value);
	});

	const pageRows = useComputed<T[]>(() => {
		if (lazy || !paginator) return processed.value;
		return processed.value.slice(first.value, first.value + pageSize);
	});

	// Flatten page rows into a linear display list (group headers + rows + expansion rows).
	const displayRows = useComputed<DisplayRow<T>[]>(() => {
		const out: DisplayRow<T>[] = [];
		let lastGroup: string | null = null;
		pageRows.value.forEach((row, i) => {
			if (groupField) {
				const g = toText(getFieldValue(row, groupField));
				if (g !== lastGroup) {
					out.push({ kind: "group", key: `group-${g}-${i}`, label: g });
					lastGroup = g;
				}
			}
			const key = getKey(row, i);
			out.push({ kind: "data", key, row, index: i });
			if (expandedRowTemplate && expandedKeys.value.has(key)) {
				out.push({ kind: "expansion", key: `${key}-exp`, row });
			}
		});
		return out;
	});
	// #endregion

	// #region Lazy load emission
	const emitLazy = () => {
		if (!lazy || !onLazyLoad) return;
		onLazyLoad({
			first: first.value,
			last: first.value + pageSize,
			rows: pageSize,
			sort: sorts.value[0],
			filters: filters.value,
		});
	};
	// #endregion

	// #region Persistence
	useEffect(() => {
		if (!stateKey) return;
		saveState<PersistedTableState>(stateKey, {
			sorts: sorts.value,
			filters: filters.value,
			order: columnOrder.value,
			widths: columnWidths.value,
			selection: [...selectedKeys.value],
		});
	}, [
		stateKey,
		sorts.value,
		filters.value,
		columnOrder.value,
		columnWidths.value,
		selectedKeys.value,
	]);
	// #endregion

	// #region Sorting
	const toggleSort = (field: string, additive: boolean) => {
		const current = sorts.value;
		const existing = current.find((s) => s.field === field);
		const dir = nextSortDir(existing?.dir ?? null);
		if (multiSort && (sortMode === "multiple" || additive)) {
			const rest = current.filter((s) => s.field !== field);
			sorts.value = dir === null ? rest : [...rest, { field, dir }];
		} else {
			sorts.value = dir === null ? [] : [{ field, dir }];
		}
		if (paginator) first.value = 0;
		emitLazy();
	};

	const ariaSortFor = (field: string): JSX.AriaAttributes["aria-sort"] => {
		const s = sorts.value.find((x) => x.field === field);
		if (!s || !s.dir) return "none";
		return s.dir === "asc" ? "ascending" : "descending";
	};
	// #endregion

	// #region Filtering
	const setFilter = (field: string, text: string, mode: FilterMatchMode) => {
		const next = { ...filters.value };
		if (text === "") delete next[field];
		else next[field] = { value: text, matchMode: mode };
		filters.value = next;
		if (paginator) first.value = 0;
		emitLazy();
	};
	const hasFilterRow = orderedColumns.value.some((c) => c.filter);
	// #endregion

	// #region Selection
	const rowSelectable = selectionMode !== null || selectionColumn;

	const emitSelection = (keys: Set<string>) => {
		if (!onSelectionChange) return;
		const chosen = value.filter((row, i) => keys.has(getKey(row, i)));
		onSelectionChange(chosen);
	};

	const toggleRow = (row: T, index: number, additive: boolean) => {
		if (!rowSelectable) return;
		const key = getKey(row, index);
		const next = new Set(selectedKeys.value);
		if (selectionMode === "single" && !selectionColumn) {
			next.clear();
			if (!selectedKeys.value.has(key)) next.add(key);
		} else if (additive || next.has(key)) {
			next.has(key) ? next.delete(key) : next.add(key);
		} else if (selectionMode === "single") {
			next.clear();
			next.add(key);
		} else {
			next.add(key);
		}
		selectedKeys.value = next;
		emitSelection(next);
	};

	const allPageKeys = useComputed(() => pageRows.value.map((r, i) => getKey(r, i)));
	const headerCheckState = useComputed<"none" | "some" | "all">(() => {
		const keys = allPageKeys.value;
		if (keys.length === 0) return "none";
		const sel = keys.filter((k) => selectedKeys.value.has(k)).length;
		return sel === 0 ? "none" : sel === keys.length ? "all" : "some";
	});
	const toggleAll = () => {
		const keys = allPageKeys.value;
		const next = new Set(selectedKeys.value);
		if (headerCheckState.value === "all") keys.forEach((k) => next.delete(k));
		else keys.forEach((k) => next.add(k));
		selectedKeys.value = next;
		emitSelection(next);
	};
	// #endregion

	// #region Expansion
	const toggleExpand = (row: T, index: number) => {
		const key = getKey(row, index);
		const next = new Set(expandedKeys.value);
		next.has(key) ? next.delete(key) : next.add(key);
		expandedKeys.value = next;
	};
	// #endregion

	// #region Column resize
	const resizeStart = (field: string, startX: number, startW: number) => {
		const onMove = (e: PointerEvent) => {
			const w = Math.max(48, startW + (e.clientX - startX));
			columnWidths.value = { ...columnWidths.value, [field]: w };
		};
		const onUp = () => {
			globalThis.removeEventListener("pointermove", onMove);
			globalThis.removeEventListener("pointerup", onUp);
		};
		globalThis.addEventListener("pointermove", onMove);
		globalThis.addEventListener("pointerup", onUp);
	};
	const nudgeWidth = (field: string, delta: number, current: number) => {
		columnWidths.value = { ...columnWidths.value, [field]: Math.max(48, current + delta) };
	};
	// #endregion

	// #region Column reorder
	const dropBefore = (targetField: string) => {
		const from = dragField.value;
		dragField.value = null;
		if (!from || from === targetField) return;
		const order = columnOrder.value.length ? [...columnOrder.value] : columns.map((c) => c.field);
		const fromIdx = order.indexOf(from);
		const toIdx = order.indexOf(targetField);
		if (fromIdx < 0 || toIdx < 0) return;
		order.splice(fromIdx, 1);
		order.splice(order.indexOf(targetField), 0, from);
		columnOrder.value = order;
	};
	// #endregion

	// #region Grid template
	const gridTemplate = useComputed<string>(() => {
		const lead: string[] = [];
		if (expandedRowTemplate) lead.push("var(--ui-table-toggle, 2.5rem)");
		if (selectionColumn) lead.push("var(--ui-table-check, 2.75rem)");
		const cols = orderedColumns.value.map((c) => {
			const w = columnWidths.value[c.field];
			if (w) return `${w}px`;
			if (c.width) return c.width;
			return "minmax(6rem, 1fr)";
		});
		return [...lead, ...cols].join(" ");
	});
	// #endregion

	// #region Virtualization
	const rowCount = displayRows.value.length;
	const virtual = useVirtualScroll({
		count: virtualScroll ? rowCount : 0,
		itemSize: virtualRowHeight,
		parentRef,
		useWindow,
		onReachEnd: lazy ? emitLazy : undefined,
	});
	// #endregion

	// #region Cell rendering
	const renderCell = (col: TableColumn<T>, row: T, index: number): VNode => {
		const content = col.body ? col.body(row, index) : toText(getFieldValue(row, col.field));
		return (
			<div
				role="cell"
				class={cx("ui-table__cell", col.class, cellClass?.(row, col))}
				style={styleVars(
					{ "--ui-table-align": col.align ?? "start" },
					col.style,
				)}
			>
				{content}
			</div>
		);
	};

	const renderDataRow = (dr: Extract<DisplayRow<T>, { kind: "data" }>, offset?: number): VNode => {
		const { row, index, key } = dr;
		const selected = selectedKeys.value.has(key);
		const expanded = expandedKeys.value.has(key);
		return (
			<div
				role="row"
				aria-selected={rowSelectable ? selected : undefined}
				aria-rowindex={lazy ? first.value + index + 1 : undefined}
				tabIndex={rowSelectable ? 0 : undefined}
				data-index={offset}
				ref={offset !== undefined ? virtual.measureElement : undefined}
				class={cx(
					"ui-table__row",
					"ui-table__row--body",
					selected && "ui-table__row--selected",
					rowClass?.(row),
				)}
				style={styleVars({ "--ui-table-cols": gridTemplate.value })}
				onClick={(e) => rowSelectable && toggleRow(row, index, e.ctrlKey || e.metaKey)}
				onKeyDown={(e) => {
					if (!rowSelectable) return;
					if (e.key === " " || e.key === "Enter") {
						e.preventDefault();
						toggleRow(row, index, e.ctrlKey || e.metaKey);
					}
				}}
			>
				{expandedRowTemplate && (
					<div role="cell" class="ui-table__cell ui-table__cell--toggle">
						<button
							type="button"
							class="ui-table__toggle"
							aria-label={expanded ? "Collapse row" : "Expand row"}
							aria-expanded={expanded}
							onClick={(e) => {
								e.stopPropagation();
								toggleExpand(row, index);
							}}
						>
							<span class="ui-table__toggle-icon" aria-hidden="true">▸</span>
						</button>
					</div>
				)}
				{selectionColumn && (
					<div role="cell" class="ui-table__cell ui-table__cell--check">
						<input
							type="checkbox"
							class="ui-table__checkbox"
							checked={selected}
							aria-label={`Select row ${index + 1}`}
							onClick={(e) => e.stopPropagation()}
							onChange={() => toggleRow(row, index, true)}
						/>
					</div>
				)}
				{orderedColumns.value.map((col) => renderCell(col, row, index))}
			</div>
		);
	};

	const leadColsSpan = (expandedRowTemplate ? 1 : 0) + (selectionColumn ? 1 : 0) +
		orderedColumns.value.length;

	const renderDisplayRow = (dr: DisplayRow<T>, offset?: number): VNode => {
		if (dr.kind === "group") {
			return (
				<div
					role="row"
					data-index={offset}
					ref={offset !== undefined ? virtual.measureElement : undefined}
					class="ui-table__row ui-table__row--group"
					style={styleVars({ "--ui-table-span": String(leadColsSpan) })}
				>
					<div role="cell" class="ui-table__group-label">{dr.label}</div>
				</div>
			);
		}
		if (dr.kind === "expansion") {
			return (
				<div
					role="row"
					data-index={offset}
					ref={offset !== undefined ? virtual.measureElement : undefined}
					class="ui-table__row ui-table__row--expansion"
					style={styleVars({ "--ui-table-span": String(leadColsSpan) })}
				>
					<div role="cell" class="ui-table__expansion">{expandedRowTemplate!(dr.row)}</div>
				</div>
			);
		}
		return renderDataRow(dr, offset);
	};
	// #endregion

	// #region Pagination
	const totalCount = lazy ? (totalRecords ?? value.length) : processed.value.length;
	const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
	const currentPage = Math.floor(first.value / pageSize);
	const goToPage = (p: number) => {
		const clamped = Math.max(0, Math.min(pageCount - 1, p));
		first.value = clamped * pageSize;
		onPage?.(first.value, pageSize);
		emitLazy();
	};
	// #endregion

	const bodyStyle = useWindow ? undefined : styleVars({
		"--ui-table-body-h": scrollHeight === "flex" ? undefined : (scrollHeight ?? undefined),
	});

	const isEmpty = !loading && displayRows.value.length === 0;

	// #region Render
	return (
		<div
			id={rootId}
			class={cx("ui-table", scrollHeight === "flex" && "ui-table--flex", className)}
		>
			{header && <div class="ui-table__header-bar">{header}</div>}

			<div
				role="table"
				aria-label={ariaLabel}
				aria-rowcount={lazy ? (totalRecords ?? -1) : undefined}
				aria-colcount={leadColsSpan}
				aria-busy={loading || undefined}
				class="ui-table__grid"
			>
				{/* Column headers */}
				<div role="rowgroup" class="ui-table__thead">
					<div
						role="row"
						class="ui-table__row ui-table__row--head"
						style={styleVars({ "--ui-table-cols": gridTemplate.value })}
					>
						{expandedRowTemplate && (
							<div
								role="columnheader"
								class="ui-table__cell ui-table__cell--toggle"
								aria-label="Expand"
							/>
						)}
						{selectionColumn && (
							<div role="columnheader" class="ui-table__cell ui-table__cell--check">
								<input
									type="checkbox"
									class="ui-table__checkbox"
									aria-label="Select all rows on this page"
									checked={headerCheckState.value === "all"}
									ref={(el) => {
										if (el) {
											el.indeterminate = headerCheckState.value === "some";
										}
									}}
									onChange={toggleAll}
								/>
							</div>
						)}
						{orderedColumns.value.map((col) => {
							const width = columnWidths.value[col.field];
							return (
								<div
									role="columnheader"
									aria-sort={col.sortable ? ariaSortFor(col.field) : undefined}
									class={cx(
										"ui-table__cell",
										"ui-table__cell--head",
										col.sortable && "ui-table__cell--sortable",
										col.frozen && "ui-table__cell--frozen",
										col.class,
									)}
									style={styleVars({ "--ui-table-align": col.align ?? "start" })}
									draggable={col.reorderable || undefined}
									onDragStart={col.reorderable ? () => (dragField.value = col.field) : undefined}
									onDragOver={col.reorderable ? (e) => e.preventDefault() : undefined}
									onDrop={col.reorderable ? () => dropBefore(col.field) : undefined}
								>
									<button
										type="button"
										class="ui-table__head-button"
										disabled={!col.sortable}
										onClick={(e) => col.sortable && toggleSort(col.field, e.shiftKey)}
										onKeyDown={(e) => {
											if (col.sortable && (e.key === "Enter" || e.key === " ")) {
												e.preventDefault();
												toggleSort(col.field, e.shiftKey);
											}
										}}
									>
										<span class="ui-table__head-label">
											{col.headerTemplate ? col.headerTemplate(col) : (col.header ?? col.field)}
										</span>
										{col.sortable && (
											<span class="ui-table__sort-icon" aria-hidden="true">
												{ariaSortFor(col.field) === "ascending"
													? "▲"
													: ariaSortFor(col.field) === "descending"
													? "▼"
													: "⇅"}
											</span>
										)}
									</button>
									{col.resizable && (
										<span
											role="separator"
											aria-orientation="vertical"
											aria-label={`Resize ${col.header ?? col.field}`}
											tabIndex={0}
											class="ui-table__resizer"
											onPointerDown={(e) => {
												e.preventDefault();
												resizeStart(
													col.field,
													e.clientX,
													width ?? (e.currentTarget.parentElement?.offsetWidth ?? 120),
												);
											}}
											onKeyDown={(e) => {
												const cur = width ??
													(e.currentTarget.parentElement?.offsetWidth ?? 120);
												if (e.key === "ArrowLeft") nudgeWidth(col.field, -12, cur);
												if (e.key === "ArrowRight") nudgeWidth(col.field, 12, cur);
											}}
										/>
									)}
								</div>
							);
						})}
					</div>

					{/* Filter row */}
					{hasFilterRow && (
						<div
							role="row"
							class="ui-table__row ui-table__row--filter"
							style={styleVars({ "--ui-table-cols": gridTemplate.value })}
						>
							{expandedRowTemplate && (
								<div role="cell" class="ui-table__cell ui-table__cell--toggle" />
							)}
							{selectionColumn && <div role="cell" class="ui-table__cell ui-table__cell--check" />}
							{orderedColumns.value.map((col) => (
								<div role="cell" class="ui-table__cell ui-table__cell--filter">
									{col.filter
										? (
											<input
												type="text"
												class="ui-table__filter-input"
												placeholder="Filter"
												aria-label={`Filter by ${col.header ?? col.field}`}
												value={toText(filters.value[col.field]?.value ?? "")}
												onInput={(e) =>
													setFilter(
														col.field,
														e.currentTarget.value,
														col.filterMatchMode ?? "contains",
													)}
											/>
										)
										: null}
								</div>
							))}
						</div>
					)}
				</div>

				{/* Body */}
				<div
					ref={parentRef}
					role="rowgroup"
					class={cx(
						"ui-table__tbody",
						!useWindow && "ui-table__tbody--scroll",
						virtualScroll && "ui-table__tbody--virtual",
					)}
					style={bodyStyle}
				>
					{loading && (
						<div class="ui-table__overlay" role="status" aria-live="polite">
							{loadingTemplate
								? loadingTemplate()
								: <span class="ui-table__spinner" aria-hidden="true" />}
						</div>
					)}

					{isEmpty && (
						<div role="row" class="ui-table__row ui-table__row--empty">
							<div role="cell" class="ui-table__empty">
								{emptyTemplate ? emptyTemplate() : "No records found"}
							</div>
						</div>
					)}

					{!isEmpty && virtualScroll
						? (
							<div
								class="ui-table__sizer"
								style={styleVars({ "--v-total": `${virtual.totalSize}px` })}
							>
								{virtual.virtualItems.map((vi) => (
									<div
										class="ui-table__virtual-row"
										style={styleVars({ "--v-top": `${vi.start}px` })}
									>
										{renderDisplayRow(displayRows.value[vi.index], vi.index)}
									</div>
								))}
							</div>
						)
						: !isEmpty
						? displayRows.value.map((dr) => renderDisplayRow(dr))
						: null}
				</div>
			</div>

			{footer && <div class="ui-table__footer-bar">{footer}</div>}

			{paginator && (
				<div class="ui-table__paginator" role="navigation" aria-label="Pagination">
					<span class="ui-table__paginator-info">
						{totalCount === 0
							? "0"
							: `${first.value + 1}–${Math.min(first.value + pageSize, totalCount)}`} of{" "}
						{totalCount}
					</span>
					<div class="ui-table__paginator-controls">
						<button
							type="button"
							class="ui-table__page-button"
							aria-label="First page"
							disabled={currentPage === 0}
							onClick={() => goToPage(0)}
						>
							«
						</button>
						<button
							type="button"
							class="ui-table__page-button"
							aria-label="Previous page"
							disabled={currentPage === 0}
							onClick={() => goToPage(currentPage - 1)}
						>
							‹
						</button>
						<span class="ui-table__page-status" aria-current="page">
							{currentPage + 1} / {pageCount}
						</span>
						<button
							type="button"
							class="ui-table__page-button"
							aria-label="Next page"
							disabled={currentPage >= pageCount - 1}
							onClick={() => goToPage(currentPage + 1)}
						>
							›
						</button>
						<button
							type="button"
							class="ui-table__page-button"
							aria-label="Last page"
							disabled={currentPage >= pageCount - 1}
							onClick={() => goToPage(pageCount - 1)}
						>
							»
						</button>
					</div>
				</div>
			)}
		</div>
	);
	// #endregion
}
