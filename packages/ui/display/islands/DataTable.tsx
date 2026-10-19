import type { ComponentChildren, JSX, Ref, RefObject } from "preact";
import { type ReadonlySignal, Signal, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";
import "../styles/data-table.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/mod.ts";
import { Button } from "../../fields/components/Button.tsx";
import type { Bindable } from "../../fields/types/mod.ts";
import { Skeleton } from "../../feedback/components/Skeleton.tsx";
import { EmptyState } from "../../utils/components/EmptyState.tsx";
import { ActionMenu } from "../../navigation/islands/ActionMenu.tsx";
import type { MenuItem } from "../../types/mod.ts";
import type {
	ColumnFilterState,
	ColumnFilterValue,
	ColumnLayout,
	DataColumn,
	DataSort,
	DateFormat,
	SelectionMode,
	SortCycle,
} from "../types/data-table.ts";
import { loadState, saveState } from "../core/collection.ts";
import {
	alignOf,
	clampWidth,
	defaultWidthOf,
	gridTemplate,
	isHideable,
	minContentWidth,
	moveColumn,
	orderedColumns,
	pinnedOffsets,
	priorityHidden,
	resizeColumn,
	resolveLayout,
	toggleHidden,
} from "../core/table-columns.ts";
import {
	filterRowsBy,
	filterSpecOf,
	isFilterActive,
	rangeUnitOf,
	searchTextOf,
	setOptionsOf,
} from "../core/table-filter.ts";
import { nextSorts, sortKeyOf, sortRowsBy } from "../core/table-sort.ts";
import { headerCheckState } from "../core/table-selection.ts";
import { type TableRowHeight, useTableViewport } from "../hooks/useTableViewport.ts";
import { useTableInput } from "../hooks/useTableInput.ts";
import type { CellContext } from "../components/DataTableCell.tsx";
import { DataTableRow } from "../components/DataTableRow.tsx";
import { DataTableHead } from "../components/DataTableHead.tsx";
import { DataTableColumnMenu } from "../components/DataTableColumnMenu.tsx";

// #region Props
/** Where the rows scroll: with the page, inside an existing scroller, or in a box of their own. */
export type DataTableScroll = "window" | { container: RefObject<HTMLElement> } | { height: string };

/** Props for {@link DataTable}. Pass `columns` as a stable (memoised or module-level) array. */
export interface DataTableProps<T> {
	rows: readonly T[];
	rowKey: (row: T) => string;
	columns: readonly DataColumn<T>[];
	"aria-label": string;
	/** The row's name in labels ("Select …", "Actions for …"); defaults to its first text-like cell. */
	rowLabel?: (row: T) => string;

	/** First load: skeleton rows at the real column widths. */
	loading?: boolean;
	/** Next page: skeleton rows after the last row, so nothing shifts when it lands. */
	loadingMore?: boolean;
	/** `false` stops `onReachEnd` from firing. */
	hasMore?: boolean;
	onReachEnd?: () => void;
	/** Distance from the end, px, at which `onReachEnd` fires (default 320). */
	endThreshold?: number;
	/** The full result size when only part of it is loaded (`aria-rowcount`). */
	totalCount?: number;
	/** Shown when there are no rows and nothing is loading. */
	empty?: ComponentChildren;

	sort?: Bindable<readonly DataSort[]>;
	onSortChange?: (next: readonly DataSort[]) => void;
	/** Default `asc-desc-none`. */
	sortCycle?: SortCycle;
	/** Shift+click adds a column to the sort (default true). */
	multiSort?: boolean;
	filters?: Bindable<ColumnFilterState>;
	onFiltersChange?: (next: ColumnFilterState) => void;
	/** `client` sorts and filters `rows` in memory; `server` only reports the state (default `client`). */
	dataMode?: "client" | "server";

	/** Default `none`. */
	selectionMode?: SelectionMode;
	selection?: Bindable<ReadonlySet<string>>;
	onSelectionChange?: (next: ReadonlySet<string>) => void;
	/** The Shift-range anchor, for a caller whose layout can remount the table mid-selection. */
	selectionAnchor?: Signal<string | null>;

	/** A plain click or Enter on a row (open a preview). Modifier clicks select instead. */
	onRowActivate?: (row: T, event: MouseEvent | KeyboardEvent) => void;
	/** The row's link: the whole row navigates, and middle-click opens a new tab. */
	rowHref?: (row: T) => string | null;
	/**
	 * Row actions, shown from a trailing kebab and on right-click / ContextMenu / Shift+F10. A menu that
	 * depends on state (a busy flag) is rebuilt whenever this function changes.
	 */
	rowActions?: (row: T) => readonly MenuItem[];
	/** `kebab` (⋮, default) or `meatball` (⋯). */
	rowActionsTrigger?: "kebab" | "meatball";
	/** A styling token for the row (`data-state`), e.g. the entity the viewer is acting as. */
	rowState?: (row: T) => string | null;

	/** Fixed px (a signal for zoom), or an estimate refined by measuring (default 48). */
	rowHeight?: number | ReadonlySignal<number> | { estimate: number };
	/** Rows at least this tall show `file` thumbnails instead of kind glyphs (default 52). */
	thumbnailMinRowHeight?: number;
	/** Default `window`. */
	scroll?: DataTableScroll;
	/** Where the sticky header stops under the page chrome (any CSS length, default `0px`). */
	stickyTop?: string;
	overscan?: number;
	/** Rows rendered before the viewport is measured (default 30). */
	initialRows?: number;
	/**
	 * `false` renders every row. For a short list inside a dialog, whose scroller is not the page
	 * and holds a bounded handful of rows (default true).
	 */
	virtualize?: boolean;

	/** Saves the viewer's widths, order and visibility under `key`; bump `version` to discard them. */
	columnState?: { key: string; version?: number };
	/** Default true. */
	resizable?: boolean;
	/** Default true. */
	reorderable?: boolean;
	/** Default true. */
	columnChooser?: boolean;
	/** `false` drops the header row, for a short list that sits above another table (default true). */
	header?: boolean;

	/** Formats numbers and dates; defaults to `en-GB`, the interface's language. */
	locale?: string;
	timeZone?: string;
	/** The app's date formatting (an enterprise's date preference). */
	formatDate?: (ms: number, format: DateFormat) => string;
	/** The stand-in picture for a person without one. */
	avatarFallback?: string;
	class?: string;
}
// #endregion

const DEFAULT_LOCALE = "en-GB";
const LEAD_PX = 40;
const TAIL_PX = 48;
const FIRST_LOAD_ROWS = 8;
const TAIL_LOAD_ROWS = 3;
const EMPTY_SORTS: readonly DataSort[] = [];
const EMPTY_FILTERS: ColumnFilterState = {};
const EMPTY_SET: ReadonlySet<string> = new Set();

interface TableState<S> {
	value: S;
	get: () => S;
	set: (next: S) => void;
}

/**
 * One piece of table state: a signal is shared (read and written in place), a value is controlled by
 * the caller through `onChange`, and nothing lets the table own it.
 */
function useTableState<S>(
	bound: Bindable<S> | undefined,
	fallback: S,
	onChange: ((next: S) => void) | undefined,
): TableState<S> {
	const own = useSignal<S>(fallback);
	const value = bound instanceof Signal ? bound.value : bound !== undefined ? bound : own.value;
	const latest = useRef(value);
	latest.current = value;
	return {
		value,
		get: () => latest.current,
		set: (next: S) => {
			latest.current = next;
			if (bound instanceof Signal) bound.value = next;
			else if (bound === undefined) own.value = next;
			onChange?.(next);
		},
	};
}

interface StoredLayout extends ColumnLayout {
	v: number;
}

function readLayout(state: DataTableProps<unknown>["columnState"]): Partial<ColumnLayout> | null {
	if (!state) return null;
	const stored = loadState<StoredLayout>(state.key);
	return stored && stored.v === (state.version ?? 1) ? stored : null;
}

function labelColumn<T>(columns: readonly DataColumn<T>[]): DataColumn<T> | undefined {
	return columns.find((c) => c.type === "file" || c.type === "text" || c.type === "person");
}

/** Measure each column cell's natural width (header included) for auto-fit. */
function naturalWidth(root: HTMLElement, columnId: string): number {
	const cells = [...root.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(columnId)}"]`)];
	for (const cell of cells) cell.style.inlineSize = "max-content";
	const widest = cells.reduce((max, cell) => Math.max(max, cell.getBoundingClientRect().width), 0);
	for (const cell of cells) cell.style.inlineSize = "";
	return Math.ceil(widest) + 2;
}

/**
 * DataTable — the one table for every tabular surface: typed cell formatters, single and multiple
 * selection (Ctrl/Cmd toggles, Shift ranges), multi-column sort, column filters with in-cell match
 * highlighting, resizable / reorderable / hideable columns that persist per surface, priority hiding
 * on a narrow table, row actions on a kebab and on right-click, and a virtualizer that windows fixed
 * or measured rows against the page or a scroller and fires `onReachEnd` for infinite scroll.
 *
 * Sort, filters and selection each take a signal (shared with other islands — a toolbar's sort, a
 * batch bar's selection), a value with its `on…Change` (controlled by the caller), or nothing (owned
 * by the table).
 */
export function DataTable<T>(props: DataTableProps<T>): JSX.Element {
	const {
		rows,
		rowKey,
		columns,
		selectionMode = "none",
		dataMode = "client",
		multiSort = true,
		sortCycle = "asc-desc-none",
		resizable = true,
		reorderable = true,
		columnChooser = true,
	} = props;

	const rootRef = useRef<HTMLDivElement>(null);
	const headRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const sortCtl = useTableState(props.sort, EMPTY_SORTS, props.onSortChange);
	const filterCtl = useTableState(props.filters, EMPTY_FILTERS, props.onFiltersChange);
	const selCtl = useTableState(props.selection, EMPTY_SET, props.onSelectionChange);
	const sorts = sortCtl.value;
	const filters = filterCtl.value;
	const selected = selCtl.value;

	const stored = useSignal<Partial<ColumnLayout> | null>(null);
	const width = useSignal(0);
	const announce = useSignal("");

	// #region Saved layout + measured width
	const stateKey = props.columnState?.key;
	useEffect(() => {
		stored.value = readLayout(props.columnState);
	}, [stateKey]);

	useEffect(() => {
		const root = rootRef.current;
		if (!root || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(([entry]) => {
			width.value = Math.round(entry.contentRect.width);
		});
		observer.observe(root);
		return () => observer.disconnect();
	}, []);
	// #endregion

	// #region Columns
	const layout = useMemo(() => resolveLayout(columns, stored.value), [columns, stored.value]);
	const ordered = useMemo(() => orderedColumns(columns, layout), [columns, layout]);
	const selectable = selectionMode !== "none";
	const chooserColumns = useMemo(
		() =>
			layout.order.map((id) => columns.find((c) => c.id === id)).filter(
				(c): c is DataColumn<T> => c !== undefined && isHideable(c),
			),
		[columns, layout],
	);
	const hasTail = Boolean(props.rowActions) || (columnChooser && chooserColumns.length > 0);
	const tracks = { lead: selectable, tail: hasTail };
	const reserved = (selectable ? LEAD_PX : 0) + (hasTail ? TAIL_PX : 0);
	const defaultWidths = useMemo(
		() => Object.fromEntries(columns.map((c) => [c.id, defaultWidthOf(c)])),
		[columns],
	);
	const droppedKey = priorityHidden(ordered, defaultWidths, width.value, reserved).join("|");
	const visible = useMemo(
		() => (droppedKey ? ordered.filter((c) => !droppedKey.split("|").includes(c.id)) : ordered),
		[ordered, droppedKey],
	);
	const aligns = useMemo(
		() => Object.fromEntries(visible.map((c) => [c.id, alignOf(c)])),
		[visible],
	);
	const pins = useMemo(() => pinnedOffsets(visible, layout.widths), [visible, layout.widths]);
	const sortKeys = useMemo(
		() => Object.fromEntries(columns.map((c) => [c.id, sortKeyOf(c)])),
		[columns],
	);
	const filterSpecs = useMemo(
		() => Object.fromEntries(columns.map((c) => [c.id, filterSpecOf(c)])),
		[columns],
	);
	const template = gridTemplate(visible, layout.widths, tracks);
	const minWidth = minContentWidth(visible, layout.widths, reserved);

	const setLayout = (next: ColumnLayout) => {
		stored.value = next;
		if (props.columnState) {
			saveState<StoredLayout>(props.columnState.key, {
				v: props.columnState.version ?? 1,
				...next,
			});
		}
	};
	// #endregion

	// #region Rows
	const processed = useMemo(
		() =>
			dataMode === "client"
				? sortRowsBy(filterRowsBy(rows, filters, columns), sorts, columns)
				: rows,
		[rows, filters, sorts, columns, dataMode],
	);
	const keys = useMemo(() => processed.map(rowKey), [processed]);
	const queries = useMemo(() => {
		const out: Record<string, string> = {};
		for (const [id, value] of Object.entries(filters)) {
			if (value.kind === "text" && value.query.trim()) out[id] = value.query.trim();
		}
		return out;
	}, [filters]);
	const labelCol = useMemo(() => labelColumn(columns), [columns]);
	const labelOf = (row: T, key: string): string =>
		props.rowLabel?.(row) ?? ((labelCol ? searchTextOf(labelCol, row) : "") || key);
	// #endregion

	// #region Viewport
	const rawHeight = props.rowHeight ?? 48;
	const rowHeight: TableRowHeight = rawHeight instanceof Signal ? rawHeight.value : rawHeight;
	const fixed = typeof rowHeight === "number" ? rowHeight : null;
	const unit = fixed ?? (rowHeight as { estimate: number }).estimate;
	const scroll = props.scroll ?? "window";
	const scrollTarget = scroll === "window"
		? "window"
		: "container" in scroll
		? scroll.container
		: bodyRef;

	const vp = useTableViewport({
		keys,
		rowHeight,
		scroll: scrollTarget,
		listRef,
		headRef,
		overscan: props.overscan ?? 6,
		initialRows: props.initialRows ?? 30,
		onReachEnd: props.hasMore === false ? undefined : props.onReachEnd,
		endThreshold: props.endThreshold ?? 320,
	});
	// #endregion

	// #region Cell context
	const locale = props.locale ?? DEFAULT_LOCALE;
	const now = useMemo(() => Date.now(), [rows]);
	const showThumbs = unit >= (props.thumbnailMinRowHeight ?? 52);
	const ctx = useMemo<CellContext>(
		() => ({
			locale,
			timeZone: props.timeZone,
			now,
			showThumbs,
			formatDate: props.formatDate,
			avatarFallback: props.avatarFallback,
		}),
		[locale, props.timeZone, now, showThumbs, props.formatDate, props.avatarFallback],
	);
	// #endregion

	// #region Selection, focus + input
	const range = props.virtualize === false ? { start: 0, end: keys.length - 1 } : vp.range;
	const input = useTableInput({
		rows: processed,
		keys,
		bodyRef,
		selectionMode,
		getSelection: selCtl.get,
		setSelection: selCtl.set,
		anchor: props.selectionAnchor,
		onRowActivate: props.onRowActivate,
		range,
		scrollIntoView: vp.scrollIntoView,
		pageRows: vp.pageRows,
		announce: (message) => (announce.value = message),
	});
	const { select, tabKey } = input;

	const onBodyScroll = () => {
		if (headRef.current && bodyRef.current) headRef.current.scrollLeft = bodyRef.current.scrollLeft;
	};
	// #endregion

	// #region Header actions
	const onSort = (key: string, append: boolean) => {
		const column = columns.find((c) => sortKeyOf(c) === key);
		const next = nextSorts(sorts, key, {
			append: append && multiSort,
			cycle: sortCycle,
			firstDir: column?.firstSortDir,
		});
		sortCtl.set(next);
		const lead = next[0];
		const leadColumn = lead ? columns.find((c) => sortKeyOf(c) === lead.key) : undefined;
		announce.value = leadColumn
			? `Sorted by ${leadColumn.header}, ${lead.dir === "asc" ? "ascending" : "descending"}`
			: "Sort cleared";
	};

	const onFilter = (columnId: string, value: ColumnFilterValue | null) => {
		const next: Record<string, ColumnFilterValue> = { ...filterCtl.get() };
		if (value && isFilterActive(value)) next[columnId] = value;
		else delete next[columnId];
		filterCtl.set(next);
	};

	const onResize = (columnId: string, w: number, commit: boolean) => {
		const column = columns.find((c) => c.id === columnId);
		if (!column) return;
		if (commit) {
			setLayout(resizeColumn(layout, column, w));
			return;
		}
		const preview = { ...layout.widths, [columnId]: clampWidth(column, w) };
		const root = rootRef.current;
		root?.style.setProperty("--dt-cols", gridTemplate(visible, preview, tracks));
		root?.style.setProperty("--dt-min-w", `${minContentWidth(visible, preview, reserved)}px`);
	};

	const onAutoFit = (columnId: string) => {
		const column = columns.find((c) => c.id === columnId);
		if (column && rootRef.current) {
			setLayout(resizeColumn(layout, column, naturalWidth(rootRef.current, columnId)));
		}
	};

	const onMove = (columnId: string, overId: string) =>
		setLayout({
			...layout,
			order: moveColumn(layout.order, columnId, layout.order.indexOf(overId)),
		});

	const onResetColumns = () => {
		if (props.columnState) saveState(props.columnState.key, null);
		stored.value = null;
	};
	// #endregion

	// #region Row actions
	const triggerIcon = props.rowActionsTrigger === "meatball" ? "kebab-horizontal" : "kebab";
	const actionsFor = props.rowActions
		? (row: T, label: string) => (surface: () => HTMLElement | null) => (
			<ActionMenu
				model={[...(props.rowActions?.(row) ?? [])]}
				aria-label={`Actions for ${label}`}
				surface={surface}
				trigger={(api) => (
					<button
						ref={api.ref as Ref<HTMLButtonElement>}
						type="button"
						class="ui-dt__action"
						aria-label={`Actions for ${label}`}
						aria-haspopup="menu"
						aria-expanded={api.expanded}
						aria-controls={api.expanded ? api.panelId : undefined}
						tabIndex={-1}
						onClick={api.toggle}
					>
						<Icon name={triggerIcon} />
					</button>
				)}
			/>
		)
		: null;
	// #endregion

	// #region Render
	const firstColIndex = selectable ? 2 : 1;
	const total = vp.metrics.total();
	const firstLoad = Boolean(props.loading) && processed.length === 0;
	const skeletonCount = firstLoad ? FIRST_LOAD_ROWS : props.loadingMore ? TAIL_LOAD_ROWS : 0;
	const sizerHeight = total + skeletonCount * unit;

	const skeletons = Array.from({ length: skeletonCount }, (_, i) => {
		const index = processed.length + i;
		return (
			<div
				key={`dt-skeleton-${i}`}
				class="ui-dt__row ui-dt__row--skeleton"
				aria-hidden="true"
				style={fixed === null ? `--dt-y:${total + i * unit}px` : `--dt-i:${index}`}
			>
				{selectable ? <div class="ui-dt__cell ui-dt__lead" /> : null}
				{visible.map((column, c) => (
					<div key={column.id} class="ui-dt__cell" data-align={aligns[column.id]}>
						<Skeleton shape="text" width={`${55 + ((index * 7 + c * 13) % 35)}%`} />
					</div>
				))}
			</div>
		);
	});

	const rendered: JSX.Element[] = [];
	for (let i = range.start; i <= range.end; i++) {
		const row = processed[i];
		const key = keys[i];
		if (row === undefined || key === undefined) continue;
		const label = labelOf(row, key);
		rendered.push(
			<DataTableRow
				key={key}
				row={row}
				rowKey={key}
				index={i}
				y={fixed === null ? vp.metrics.offsetOf(i) : null}
				columns={visible}
				aligns={aligns}
				queries={queries}
				pins={pins}
				ctx={ctx}
				selectable={selectable}
				selected={selected.has(key)}
				focused={key === tabKey}
				label={label}
				href={props.rowHref?.(row) ?? null}
				state={props.rowState?.(row) ?? null}
				actions={actionsFor ? actionsFor(row, label) : null}
				actionsSource={props.rowActions}
				measure={fixed === null ? vp.measureRow : null}
				firstColIndex={firstColIndex}
			/>,
		);
	}

	const filtering = Object.values(filters).some(isFilterActive);
	const isEmpty = !props.loading && processed.length === 0;
	const scrollMode = scroll === "window" ? "window" : "container" in scroll ? "container" : "box";
	const boxHeight = typeof scroll === "object" && "height" in scroll
		? `--dt-body-h:${scroll.height};`
		: "";

	const grid = (
		<div
			ref={rootRef}
			class={cx("ui-dt", props.class)}
			role="grid"
			aria-label={props["aria-label"]}
			aria-rowcount={(props.totalCount ?? processed.length) + 1}
			aria-colcount={visible.length + (selectable ? 1 : 0) + (hasTail ? 1 : 0)}
			aria-multiselectable={selectionMode === "multiple" ? true : undefined}
			aria-busy={props.loading || props.loadingMore ? true : undefined}
			data-scroll={scrollMode}
			data-lead={selectable ? "true" : undefined}
			data-clickable={selectable || props.onRowActivate || props.rowHref ? "true" : undefined}
			data-selecting={selected.size > 0 ? "true" : undefined}
			data-measured={fixed === null ? "true" : undefined}
			style={`--dt-cols:${template};--dt-min-w:${minWidth}px;--dt-row-h:${unit}px;--dt-sticky-top:${
				props.stickyTop ?? "0px"
			};${boxHeight}`}
		>
			{props.header === false ? null : (
				<DataTableHead
					columns={visible}
					aligns={aligns}
					pins={pins}
					widths={layout.widths}
					sortKeys={sortKeys}
					sorts={sorts}
					onSort={onSort}
					filterSpecs={filterSpecs}
					filters={filters}
					onFilter={onFilter}
					optionsOf={(column) => setOptionsOf(column, rows)}
					unitOf={rangeUnitOf}
					resizable={resizable}
					onResize={onResize}
					onAutoFit={onAutoFit}
					reorderable={reorderable}
					onMove={onMove}
					lead={selectable
						? {
							state: headerCheckState(selected, keys),
							multiple: selectionMode === "multiple",
							onToggle: () =>
								select(
									headerCheckState(selected, keys) === "all" ? { kind: "none" } : { kind: "all" },
								),
						}
						: null}
					tail={columnChooser && chooserColumns.length > 0
						? (
							<DataTableColumnMenu
								columns={chooserColumns}
								hidden={layout.hidden}
								onToggle={(id) => setLayout(toggleHidden(layout, id))}
								onReset={onResetColumns}
							/>
						)
						: null}
					hasTail={hasTail}
					headRef={headRef}
					firstColIndex={firstColIndex}
				/>
			)}
			<div
				ref={bodyRef}
				class="ui-dt__body"
				role="rowgroup"
				onClick={input.onClick}
				onMouseDown={input.onMouseDown}
				onKeyDown={input.onKeyDown}
				onFocusIn={input.onFocusIn}
				onScroll={onBodyScroll}
			>
				<div
					ref={listRef}
					class="ui-dt__sizer"
					role="presentation"
					style={`block-size:${sizerHeight}px`}
				>
					{rendered}
					{skeletons}
				</div>
				{isEmpty
					? (
						<div class="ui-dt__empty-state">
							{dataMode === "client" && filtering && rows.length > 0
								? (
									<EmptyState
										size="sm"
										title="No rows match these filters"
										actions={
											<Button
												variant="text"
												size="sm"
												onClick={() => filterCtl.set(EMPTY_FILTERS)}
											>
												Clear filters
											</Button>
										}
									/>
								)
								: props.empty ?? <EmptyState size="sm" title="Nothing here yet" />}
						</div>
					)
					: null}
			</div>
		</div>
	);
	// The live region is the grid's sibling: `role="grid"` may own only rows and row groups.
	return (
		<>
			{grid}
			<div class="ui-visually-hidden" role="status" aria-live="polite">{announce.value}</div>
		</>
	);
	// #endregion
}
