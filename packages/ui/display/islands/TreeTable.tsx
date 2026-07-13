import type { JSX, VNode } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/treetable.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import { useVirtualScroll } from "../../hooks/useVirtualScroll.ts";
import type { SortState, TreeNode } from "../../types/mod.ts";
import { compareValues, getFieldValue, nextSortDir, toText } from "../core/collection.ts";
import type { TableColumn } from "../types/mod.ts";

// #region Props
/** Tree-table selection strategy. `null` disables selection. */
export type TreeSelectionMode = "single" | "multiple" | null;

/**
 * Props for {@link TreeTable} — a generic tabular tree over `TreeNode<T>[]`. The first column is
 * hierarchical (toggle + indentation); the remaining columns behave like a flat table (sortable,
 * templated) over each node's `data` payload.
 *
 * @typeParam T The node `data` payload type.
 */
export interface TreeTableProps<T> {
	/** Root nodes; `children` nest sub-nodes (`leaf: false` marks an un-loaded lazy branch). */
	value: TreeNode<T>[];
	/** Column descriptors; the first is rendered as the hierarchical column. */
	columns: TableColumn<T>[];
	/** Single/multi-column sort strategy applied to siblings at every level. */
	sortMode?: "single" | "multiple";
	/** Selection strategy. */
	selectionMode?: TreeSelectionMode;
	/** Render a checkbox column with tri-state parent/child propagation. */
	selectionColumn?: boolean;
	/** Fired with the set of selected (fully-checked) node keys. */
	onSelectionChange?: (keys: string[]) => void;
	/** Fired when a node expands — load children lazily and mutate the tree, then update `value`. */
	onNodeExpand?: (node: TreeNode<T>) => void;
	/** Window the flattened visible-node list (needs `virtualRowHeight`). */
	virtualScroll?: boolean;
	/** Estimated/fixed row height in px for the windowed renderer (default 44). */
	virtualRowHeight?: number;
	/** Body scroll container height, or `"flex"`. Ignored when `useWindow`. */
	scrollHeight?: string | "flex";
	/** Virtualize against the page scroll instead of an inner container. */
	useWindow?: boolean;
	/** Show the loading overlay / `loadingTemplate`. */
	loading?: boolean;
	/** Per-node row class hook. */
	rowClass?: (node: TreeNode<T>) => string | undefined;
	/** Per-cell class hook. */
	cellClass?: (node: TreeNode<T>, column: TableColumn<T>) => string | undefined;
	/** Content shown when there are no nodes. */
	emptyTemplate?: () => VNode | string;
	/** Overlay shown while `loading`. */
	loadingTemplate?: () => VNode | string;
	/** Accessible name for the treegrid. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Flatten model
interface FlatNode<T> {
	node: TreeNode<T>;
	level: number;
	posInSet: number;
	setSize: number;
	expandable: boolean;
	expanded: boolean;
}

/** Depth-first flatten of only the visible nodes (children of expanded ancestors), post-sort. */
function flattenVisible<T>(
	roots: TreeNode<T>[],
	expanded: Set<string>,
	sort: SortState | undefined,
	level: number,
	out: FlatNode<T>[],
): void {
	const siblings = sort?.dir ? sortNodes(roots, sort) : roots;
	siblings.forEach((node, i) => {
		const hasChildren = !!node.children?.length;
		const expandable = hasChildren || node.leaf === false;
		const isExpanded = expanded.has(node.key);
		out.push({
			node,
			level,
			posInSet: i + 1,
			setSize: siblings.length,
			expandable,
			expanded: isExpanded,
		});
		if (isExpanded && hasChildren) {
			flattenVisible(node.children!, expanded, sort, level + 1, out);
		}
	});
}

/** Sort a sibling list by a single active sort (stable). */
function sortNodes<T>(nodes: TreeNode<T>[], sort: SortState): TreeNode<T>[] {
	const indexed = nodes.map((node, i) => ({ node, i }));
	indexed.sort((a, b) => {
		const cmp = compareValues(
			getFieldValue(a.node.data, sort.field),
			getFieldValue(b.node.data, sort.field),
		);
		if (cmp !== 0) return sort.dir === "asc" ? cmp : -cmp;
		return a.i - b.i;
	});
	return indexed.map((e) => e.node);
}
// #endregion

// #region Selection helpers
/** Collect a node's key plus every descendant key. */
function collectKeys<T>(node: TreeNode<T>, into: Set<string>): void {
	into.add(node.key);
	node.children?.forEach((c) => collectKeys(c, into));
}

/** True when at least one descendant key is checked (drives the indeterminate state). */
function anyDescendantChecked<T>(node: TreeNode<T>, checked: Set<string>): boolean {
	if (!node.children?.length) return false;
	return node.children.some((c) => checked.has(c.key) || anyDescendantChecked(c, checked));
}
// #endregion

/**
 * TreeTable — a generic tabular tree. The hierarchical first column carries expand/collapse toggles
 * and indentation; other columns render + sort each node's `data`. Supports single/multiple
 * selection with an optional tri-state checkbox column (parent ↔ child propagation), lazy child
 * loading (`onNodeExpand`), virtualization of the flattened visible-node list, conditional styling
 * and per-column templates.
 *
 * Keyboard (treegrid): Up/Down move between visible rows (roving tabindex), Right expands or steps
 * into the first child, Left collapses or steps to the parent, Enter/Space select. ARIA:
 * `role="treegrid"` with `aria-level`, `aria-posinset`, `aria-setsize` and `aria-expanded`.
 */
export function TreeTable<T>(props: TreeTableProps<T>): JSX.Element {
	const {
		value,
		columns,
		sortMode = "single",
		selectionMode = null,
		selectionColumn = false,
		onSelectionChange,
		onNodeExpand,
		virtualScroll = false,
		virtualRowHeight = 44,
		scrollHeight,
		useWindow = false,
		loading = false,
		rowClass,
		cellClass,
		emptyTemplate,
		loadingTemplate,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const rootId = useId(undefined, "treetable");
	const parentRef = useRef<HTMLDivElement>(null);

	// #region State
	const sorts = useSignal<SortState[]>([]);
	const expandedKeys = useSignal<Set<string>>(new Set());
	const checkedKeys = useSignal<Set<string>>(new Set());
	const selectedKeys = useSignal<Set<string>>(new Set());
	const focusIndex = useSignal<number>(0);
	// #endregion

	// #region Flatten pipeline
	const flat = useComputed<FlatNode<T>[]>(() => {
		const out: FlatNode<T>[] = [];
		flattenVisible(value, expandedKeys.value, sorts.value[0], 0, out);
		return out;
	});
	// #endregion

	// #region Grid template
	const gridTemplate = useComputed<string>(() => {
		const lead = selectionColumn ? ["var(--ui-treetable-check, 2.75rem)"] : [];
		const cols = columns.map((c, i) => {
			if (c.width) return c.width;
			return i === 0 ? "minmax(12rem, 1.5fr)" : "minmax(6rem, 1fr)";
		});
		return [...lead, ...cols].join(" ");
	});
	// #endregion

	// #region Sorting
	const toggleSort = (field: string, additive: boolean) => {
		const existing = sorts.value.find((s) => s.field === field);
		const dir = nextSortDir(existing?.dir ?? null);
		if (sortMode === "multiple" || additive) {
			const rest = sorts.value.filter((s) => s.field !== field);
			sorts.value = dir === null ? rest : [...rest, { field, dir }];
		} else {
			sorts.value = dir === null ? [] : [{ field, dir }];
		}
	};
	const ariaSortFor = (field: string): JSX.AriaAttributes["aria-sort"] => {
		const s = sorts.value.find((x) => x.field === field);
		if (!s || !s.dir) return "none";
		return s.dir === "asc" ? "ascending" : "descending";
	};
	// #endregion

	// #region Expansion
	const toggleExpand = (fn: FlatNode<T>) => {
		const key = fn.node.key;
		const next = new Set(expandedKeys.value);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
			if (fn.node.leaf === false && !fn.node.children?.length) onNodeExpand?.(fn.node);
		}
		expandedKeys.value = next;
	};
	// #endregion

	// #region Selection
	const emitChecked = (keys: Set<string>) => onSelectionChange?.([...keys]);

	const toggleCheck = (node: TreeNode<T>) => {
		const next = new Set(checkedKeys.value);
		const subtree = new Set<string>();
		collectKeys(node, subtree);
		const wasChecked = next.has(node.key);
		subtree.forEach((k) => (wasChecked ? next.delete(k) : next.add(k)));
		recomputeAncestors(value, next);
		checkedKeys.value = next;
		emitChecked(next);
	};

	/** Walk the whole tree bottom-up: a parent is checked iff all its children are checked. */
	const recomputeAncestors = (nodes: TreeNode<T>[], checked: Set<string>): boolean => {
		let allChecked = nodes.length > 0;
		for (const n of nodes) {
			if (n.children?.length) {
				const childrenAllChecked = recomputeAncestors(n.children, checked);
				if (childrenAllChecked) checked.add(n.key);
				else checked.delete(n.key);
			}
			if (!checked.has(n.key)) allChecked = false;
		}
		return allChecked;
	};

	const selectRow = (node: TreeNode<T>, additive: boolean) => {
		if (selectionMode === null) return;
		if (node.selectable === false) return;
		const next = new Set(selectionMode === "single" ? [] : selectedKeys.value);
		if (selectionMode === "multiple" && (additive || next.has(node.key))) {
			next.has(node.key) ? next.delete(node.key) : next.add(node.key);
		} else {
			next.has(node.key) ? next.delete(node.key) : next.add(node.key);
		}
		selectedKeys.value = next;
	};
	// #endregion

	// #region Keyboard (roving)
	const moveFocus = (delta: number) => {
		const n = flat.value.length;
		if (n === 0) return;
		focusIndex.value = Math.max(0, Math.min(n - 1, focusIndex.value + delta));
	};

	const onRowKeyDown = (
		e: JSX.TargetedKeyboardEvent<HTMLDivElement>,
		fn: FlatNode<T>,
		_i: number,
	) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				moveFocus(1);
				break;
			case "ArrowUp":
				e.preventDefault();
				moveFocus(-1);
				break;
			case "ArrowRight":
				e.preventDefault();
				if (fn.expandable && !fn.expanded) toggleExpand(fn);
				else moveFocus(1);
				break;
			case "ArrowLeft":
				e.preventDefault();
				if (fn.expandable && fn.expanded) toggleExpand(fn);
				else moveFocus(-1);
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				if (selectionColumn) toggleCheck(fn.node);
				else selectRow(fn.node, e.ctrlKey || e.metaKey);
				break;
			case "Home":
				e.preventDefault();
				focusIndex.value = 0;
				break;
			case "End":
				e.preventDefault();
				focusIndex.value = flat.value.length - 1;
				break;
		}
	};
	// #endregion

	// #region Virtualization
	const virtual = useVirtualScroll({
		count: virtualScroll ? flat.value.length : 0,
		itemSize: virtualRowHeight,
		parentRef,
		useWindow,
	});
	// #endregion

	// #region Cell rendering
	const renderCell = (col: TableColumn<T>, fn: FlatNode<T>, colIndex: number): VNode => {
		const isTreeCol = colIndex === 0;
		const value = col.body
			? col.body(fn.node.data as T, fn.posInSet - 1)
			: (col.field ? toText(getFieldValue(fn.node.data, col.field)) : fn.node.label ?? "");
		return (
			<div
				role="gridcell"
				class={cx("ui-treetable__cell", col.class, cellClass?.(fn.node, col))}
				style={styleVars(
					{
						"--ui-treetable-align": col.align ?? "start",
						"--ui-treetable-indent": isTreeCol ? String(fn.level) : undefined,
					},
					col.style,
				)}
			>
				{isTreeCol
					? (
						<span class="ui-treetable__node">
							<span class="ui-treetable__indent" aria-hidden="true" />
							{fn.expandable
								? (
									<button
										type="button"
										class="ui-treetable__toggle"
										aria-label={fn.expanded ? "Collapse" : "Expand"}
										aria-expanded={fn.expanded}
										onClick={(e) => {
											e.stopPropagation();
											toggleExpand(fn);
										}}
									>
										<span class="ui-treetable__toggle-icon" aria-hidden="true">▸</span>
									</button>
								)
								: (
									<span
										class="ui-treetable__toggle ui-treetable__toggle--placeholder"
										aria-hidden="true"
									/>
								)}
							<span class="ui-treetable__label">{value}</span>
						</span>
					)
					: value}
			</div>
		);
	};

	const renderRow = (fn: FlatNode<T>, i: number, offset?: number): VNode => {
		const key = fn.node.key;
		const selected = selectedKeys.value.has(key);
		const checked = checkedKeys.value.has(key);
		const indeterminate = !checked && anyDescendantChecked(fn.node, checkedKeys.value);
		return (
			<div
				role="row"
				aria-level={fn.level + 1}
				aria-posinset={fn.posInSet}
				aria-setsize={fn.setSize}
				aria-expanded={fn.expandable ? fn.expanded : undefined}
				aria-selected={selectionMode ? selected : undefined}
				tabIndex={i === focusIndex.value ? 0 : -1}
				data-index={offset}
				ref={offset !== undefined ? virtual.measureElement : undefined}
				class={cx(
					"ui-treetable__row",
					selected && "ui-treetable__row--selected",
					rowClass?.(fn.node),
					fn.node.class,
				)}
				style={styleVars({ "--ui-treetable-cols": gridTemplate.value })}
				onFocus={() => (focusIndex.value = i)}
				onClick={(e) => selectRow(fn.node, e.ctrlKey || e.metaKey)}
				onKeyDown={(e) => onRowKeyDown(e, fn, i)}
			>
				{selectionColumn && (
					<div role="gridcell" class="ui-treetable__cell ui-treetable__cell--check">
						<input
							type="checkbox"
							class="ui-treetable__checkbox"
							checked={checked}
							aria-label={`Select ${fn.node.label ?? fn.node.key}`}
							ref={(el) => {
								if (el) {
									el.indeterminate = indeterminate;
								}
							}}
							onClick={(e) =>
								e.stopPropagation()}
							onChange={() =>
								toggleCheck(fn.node)}
						/>
					</div>
				)}
				{columns.map((col, ci) => renderCell(col, fn, ci))}
			</div>
		);
	};
	// #endregion

	const bodyStyle = useWindow ? undefined : styleVars({
		"--ui-treetable-body-h": scrollHeight === "flex" ? undefined : (scrollHeight ?? undefined),
	});
	const isEmpty = !loading && flat.value.length === 0;
	const colCount = columns.length + (selectionColumn ? 1 : 0);

	// #region Render
	return (
		<div
			id={rootId}
			role="treegrid"
			aria-label={ariaLabel}
			aria-colcount={colCount}
			aria-busy={loading || undefined}
			class={cx("ui-treetable", scrollHeight === "flex" && "ui-treetable--flex", className)}
		>
			{/* Header */}
			<div role="rowgroup" class="ui-treetable__thead">
				<div
					role="row"
					class="ui-treetable__row ui-treetable__row--head"
					style={styleVars({ "--ui-treetable-cols": gridTemplate.value })}
				>
					{selectionColumn && (
						<div
							role="columnheader"
							class="ui-treetable__cell ui-treetable__cell--check"
							aria-label="Select"
						/>
					)}
					{columns.map((col) => (
						<div
							role="columnheader"
							aria-sort={col.sortable ? ariaSortFor(col.field) : undefined}
							class={cx(
								"ui-treetable__cell",
								"ui-treetable__cell--head",
								col.sortable && "ui-treetable__cell--sortable",
								col.class,
							)}
							style={styleVars({ "--ui-treetable-align": col.align ?? "start" })}
						>
							<button
								type="button"
								class="ui-treetable__head-button"
								disabled={!col.sortable}
								onClick={(e) => col.sortable && toggleSort(col.field, e.shiftKey)}
							>
								<span class="ui-treetable__head-label">
									{col.headerTemplate ? col.headerTemplate(col) : (col.header ?? col.field)}
								</span>
								{col.sortable && (
									<span class="ui-treetable__sort-icon" aria-hidden="true">
										{ariaSortFor(col.field) === "ascending"
											? "▲"
											: ariaSortFor(col.field) === "descending"
											? "▼"
											: "⇅"}
									</span>
								)}
							</button>
						</div>
					))}
				</div>
			</div>

			{/* Body */}
			<div
				ref={parentRef}
				role="rowgroup"
				class={cx(
					"ui-treetable__tbody",
					!useWindow && "ui-treetable__tbody--scroll",
					virtualScroll && "ui-treetable__tbody--virtual",
				)}
				style={bodyStyle}
			>
				{loading && (
					<div class="ui-treetable__overlay" role="status" aria-live="polite">
						{loadingTemplate
							? loadingTemplate()
							: <span class="ui-treetable__spinner" aria-hidden="true" />}
					</div>
				)}

				{isEmpty && (
					<div role="row" class="ui-treetable__row ui-treetable__row--empty">
						<div role="gridcell" class="ui-treetable__empty">
							{emptyTemplate ? emptyTemplate() : "No records found"}
						</div>
					</div>
				)}

				{!isEmpty && virtualScroll
					? (
						<div
							class="ui-treetable__sizer"
							style={styleVars({ "--v-total": `${virtual.totalSize}px` })}
						>
							{virtual.virtualItems.map((vi) => (
								<div
									class="ui-treetable__virtual-row"
									style={styleVars({ "--v-top": `${vi.start}px` })}
								>
									{renderRow(flat.value[vi.index], vi.index, vi.index)}
								</div>
							))}
						</div>
					)
					: !isEmpty
					? flat.value.map((fn, i) => renderRow(fn, i))
					: null}
			</div>
		</div>
	);
	// #endregion
}
