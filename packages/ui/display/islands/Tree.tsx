import type { JSX, VNode } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/tree.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import { useVirtualScroll } from "../../hooks/useVirtualScroll.ts";
import type { TreeNode } from "../../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Tree selection strategy. `null` disables selection. */
export type TreeSelectionMode = "single" | "multiple" | null;

/** Where a dragged node lands relative to the drop-target node. */
export type TreeDropPosition = "before" | "inside" | "after";

/** Payload emitted when a node is moved by pointer or keyboard. */
export interface TreeDropEvent<T> {
	dragNode: TreeNode<T>;
	dropNode: TreeNode<T>;
	position: TreeDropPosition;
}

/**
 * Props for {@link Tree} — a generic hierarchical list over `TreeNode<T>[]`.
 *
 * @typeParam T The node `data` payload type.
 */
export interface TreeProps<T> {
	/** Root nodes; `children` nest sub-nodes (`leaf: false` marks an un-loaded lazy branch). */
	value: TreeNode<T>[];
	/** Selection strategy for row selection (independent of `checkbox`). */
	selectionMode?: TreeSelectionMode;
	/** Render tri-state checkboxes with parent/child propagation. */
	checkbox?: boolean;
	/** Fired with selected node keys (checkbox mode emits fully-checked keys). */
	onSelectionChange?: (keys: string[]) => void;
	/** Render the filter input; nodes are matched by `filterBy` (default label). */
	filter?: boolean;
	/** Placeholder for the filter input. */
	filterPlaceholder?: string;
	/** Value projected for filtering + type-ahead (defaults to `label`). */
	filterBy?: (node: TreeNode<T>) => string;
	/** Enable pointer + keyboard drag-and-drop reordering/reparenting. */
	dragdrop?: boolean;
	/** Fired when a node is dropped (pointer) or moved (Alt+Arrow). Update `value` in response. */
	onNodeDrop?: (event: TreeDropEvent<T>) => void;
	/** Fired when a node expands — load children lazily, then update `value`. */
	onNodeExpand?: (node: TreeNode<T>) => void;
	/** Right-click hook; call `event.preventDefault()` to suppress the native menu. */
	onContextMenu?: (node: TreeNode<T>, event: MouseEvent) => void;
	/** Inline context-menu renderer, shown anchored to the node when `onContextMenu` opens it. */
	contextMenuTemplate?: (node: TreeNode<T>) => VNode;
	/** Window the flattened visible-node list (needs `virtualRowHeight`). */
	virtualScroll?: boolean;
	/** Estimated/fixed node height in px for the windowed renderer (default 36). */
	virtualRowHeight?: number;
	/** Scroll container height, or `"flex"`. Ignored when `useWindow`. */
	scrollHeight?: string | "flex";
	/** Virtualize against the page scroll instead of an inner container. */
	useWindow?: boolean;
	/** Custom node-label renderer. */
	nodeTemplate?: (node: TreeNode<T>) => VNode | string;
	/** Custom disclosure-toggle renderer. */
	togglerTemplate?: (node: TreeNode<T>, expanded: boolean) => VNode;
	/** Content shown when there are no (matching) nodes. */
	emptyTemplate?: () => VNode | string;
	/** Accessible name for the tree. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Flatten model
interface FlatTreeNode<T> {
	node: TreeNode<T>;
	level: number;
	posInSet: number;
	setSize: number;
	expandable: boolean;
	expanded: boolean;
	parentKey: string | null;
}

/** Default filter/type-ahead projection: node label (or key). */
function defaultLabel<T>(node: TreeNode<T>): string {
	return node.label ?? node.key;
}

/**
 * Depth-first flatten of the visible nodes. When `matched` is provided (filter active), a node is
 * kept only if it or a descendant matched; matching branches are treated as expanded so results stay
 * visible.
 */
function flattenTree<T>(
	roots: TreeNode<T>[],
	expanded: Set<string>,
	matched: Set<string> | null,
	level: number,
	parentKey: string | null,
	out: FlatTreeNode<T>[],
): void {
	const list = matched ? roots.filter((n) => matched.has(n.key)) : roots;
	list.forEach((node, i) => {
		const hasChildren = !!node.children?.length;
		const expandable = hasChildren || node.leaf === false;
		const isExpanded = matched ? true : expanded.has(node.key);
		out.push({
			node,
			level,
			posInSet: i + 1,
			setSize: list.length,
			expandable,
			expanded: isExpanded,
			parentKey,
		});
		if (isExpanded && hasChildren) {
			flattenTree(node.children!, expanded, matched, level + 1, node.key, out);
		}
	});
}

/** Build the set of keys to keep under an active filter: matches plus all their ancestors. */
function computeMatched<T>(
	roots: TreeNode<T>[],
	predicate: (node: TreeNode<T>) => boolean,
): Set<string> {
	const keep = new Set<string>();
	const walk = (node: TreeNode<T>): boolean => {
		let childMatch = false;
		node.children?.forEach((c) => {
			if (walk(c)) childMatch = true;
		});
		const self = predicate(node);
		if (self || childMatch) keep.add(node.key);
		return self || childMatch;
	};
	roots.forEach(walk);
	return keep;
}
// #endregion

// #region Selection helpers
function collectKeys<T>(node: TreeNode<T>, into: Set<string>): void {
	into.add(node.key);
	node.children?.forEach((c) => collectKeys(c, into));
}
function anyDescendantChecked<T>(node: TreeNode<T>, checked: Set<string>): boolean {
	if (!node.children?.length) return false;
	return node.children.some((c) => checked.has(c.key) || anyDescendantChecked(c, checked));
}
// #endregion

/**
 * Tree — a generic hierarchical navigator over `TreeNode<T>[]`. Supports single/multiple row
 * selection, tri-state checkboxes with parent/child propagation, text filtering with match
 * highlighting, pointer + keyboard drag-and-drop reordering/reparenting, a context-menu hook, lazy
 * child loading and optional virtualization of the visible-node list.
 *
 * Keyboard (WAI-ARIA tree): Up/Down move a roving focus, Right expands or steps into the first
 * child, Left collapses or steps to the parent, Home/End jump to ends, Enter/Space select (or toggle
 * the checkbox), printable characters type-ahead, and Alt+Up/Alt+Down move the focused node among
 * its siblings (emitting `onNodeDrop`). ARIA: `role="tree"` with `treeitem` rows carrying
 * `aria-level`/`aria-setsize`/`aria-posinset`/`aria-expanded`/`aria-selected`/`aria-checked`.
 */
export function Tree<T>(props: TreeProps<T>): JSX.Element {
	const {
		value,
		selectionMode = null,
		checkbox = false,
		onSelectionChange,
		filter = false,
		filterPlaceholder = "Search",
		filterBy = defaultLabel,
		dragdrop = false,
		onNodeDrop,
		onNodeExpand,
		onContextMenu,
		contextMenuTemplate,
		virtualScroll = false,
		virtualRowHeight = 36,
		scrollHeight,
		useWindow = false,
		nodeTemplate,
		togglerTemplate,
		emptyTemplate,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const rootId = useId(undefined, "tree");
	const parentRef = useRef<HTMLDivElement>(null);
	const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

	// #region State
	const expandedKeys = useSignal<Set<string>>(new Set());
	const selectedKeys = useSignal<Set<string>>(new Set());
	const checkedKeys = useSignal<Set<string>>(new Set());
	const focusKey = useSignal<string | null>(null);
	const query = useSignal<string>("");
	const dragKey = useSignal<string | null>(null);
	const dropTarget = useSignal<{ key: string; position: TreeDropPosition } | null>(null);
	const contextKey = useSignal<string | null>(null);
	// #endregion

	// #region Filter + flatten
	const matched = useComputed<Set<string> | null>(() => {
		const q = query.value.trim().toLowerCase();
		if (!filter || q === "") return null;
		return computeMatched(value, (n) => filterBy(n).toLowerCase().includes(q));
	});

	const flat = useComputed<FlatTreeNode<T>[]>(() => {
		const out: FlatTreeNode<T>[] = [];
		flattenTree(value, expandedKeys.value, matched.value, 0, null, out);
		return out;
	});
	// #endregion

	// #region Expansion
	const toggleExpand = (fn: FlatTreeNode<T>) => {
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
	const selectRow = (node: TreeNode<T>, _additive: boolean) => {
		if (selectionMode === null || node.selectable === false) return;
		const next = new Set(selectionMode === "single" ? [] : selectedKeys.value);
		if (next.has(node.key)) next.delete(node.key);
		else next.add(node.key);
		if (selectionMode === "single") {
			next.clear();
			next.add(node.key);
		}
		selectedKeys.value = next;
		onSelectionChange?.([...next]);
	};

	const toggleCheck = (node: TreeNode<T>) => {
		const next = new Set(checkedKeys.value);
		const subtree = new Set<string>();
		collectKeys(node, subtree);
		const wasChecked = next.has(node.key);
		subtree.forEach((k) => (wasChecked ? next.delete(k) : next.add(k)));
		recomputeAncestors(value, next);
		checkedKeys.value = next;
		onSelectionChange?.([...next]);
	};

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
	// #endregion

	// #region Navigation + keyboard
	const indexOfFocus = () => {
		const k = focusKey.value ?? flat.value[0]?.node.key ?? null;
		return flat.value.findIndex((f) => f.node.key === k);
	};
	const focusAt = (i: number) => {
		const n = flat.value.length;
		if (n === 0) return;
		const idx = Math.max(0, Math.min(n - 1, i));
		focusKey.value = flat.value[idx].node.key;
	};

	const typeaheadJump = (ch: string) => {
		const now = Date.now();
		const t = typeahead.current;
		t.buffer = now - t.at > 700 ? ch : t.buffer + ch;
		t.at = now;
		const from = indexOfFocus();
		const n = flat.value.length;
		for (let step = 1; step <= n; step++) {
			const i = (from + step + n) % n;
			if (filterBy(flat.value[i].node).toLowerCase().startsWith(t.buffer.toLowerCase())) {
				focusAt(i);
				return;
			}
		}
	};

	const moveSibling = (fn: FlatTreeNode<T>, dir: -1 | 1) => {
		if (!dragdrop || !onNodeDrop) return;
		const siblings = flat.value.filter((f) => f.parentKey === fn.parentKey);
		const pos = siblings.findIndex((f) => f.node.key === fn.node.key);
		const target = siblings[pos + dir];
		if (!target) return;
		onNodeDrop({
			dragNode: fn.node,
			dropNode: target.node,
			position: dir === -1 ? "before" : "after",
		});
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const i = indexOfFocus();
		const fn = flat.value[i];
		if (!fn) return;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				e.altKey ? moveSibling(fn, 1) : focusAt(i + 1);
				break;
			case "ArrowUp":
				e.preventDefault();
				e.altKey ? moveSibling(fn, -1) : focusAt(i - 1);
				break;
			case "ArrowRight":
				e.preventDefault();
				if (fn.expandable && !fn.expanded) toggleExpand(fn);
				else focusAt(i + 1);
				break;
			case "ArrowLeft":
				e.preventDefault();
				if (fn.expandable && fn.expanded) toggleExpand(fn);
				else {
					const parent = flat.value.findIndex((f) => f.node.key === fn.parentKey);
					if (parent >= 0) focusAt(parent);
				}
				break;
			case "Home":
				e.preventDefault();
				focusAt(0);
				break;
			case "End":
				e.preventDefault();
				focusAt(flat.value.length - 1);
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				if (checkbox) toggleCheck(fn.node);
				else selectRow(fn.node, e.ctrlKey || e.metaKey);
				break;
			default:
				if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
					e.preventDefault();
					typeaheadJump(e.key);
				}
		}
	};
	// #endregion

	// #region Drag and drop
	const dropPositionFrom = (
		e: JSX.TargetedEvent<HTMLElement, DragEvent>,
		expandable: boolean,
	): TreeDropPosition => {
		const rect = e.currentTarget.getBoundingClientRect();
		const ratio = (e.clientY - rect.top) / rect.height;
		if (expandable && ratio > 0.33 && ratio < 0.67) return "inside";
		return ratio < 0.5 ? "before" : "after";
	};

	const onDrop = (fn: FlatTreeNode<T>) => {
		const from = dragKey.value;
		const target = dropTarget.value;
		dragKey.value = null;
		dropTarget.value = null;
		if (!from || !target || from === fn.node.key) return;
		const dragNode = flat.value.find((f) => f.node.key === from)?.node;
		if (dragNode) onNodeDrop?.({ dragNode, dropNode: fn.node, position: target.position });
	};
	// #endregion

	// #region Context menu
	const handleContext = (fn: FlatTreeNode<T>, e: JSX.TargetedMouseEvent<HTMLElement>) => {
		if (!onContextMenu && !contextMenuTemplate) return;
		focusKey.value = fn.node.key;
		if (contextMenuTemplate) {
			e.preventDefault();
			contextKey.value = contextKey.value === fn.node.key ? null : fn.node.key;
		}
		onContextMenu?.(fn.node, e as unknown as MouseEvent);
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

	// #region Node rendering
	const highlight = (text: string): VNode | string => {
		const q = query.value.trim();
		if (!filter || q === "") return text;
		const idx = text.toLowerCase().indexOf(q.toLowerCase());
		if (idx < 0) return text;
		return (
			<>
				{text.slice(0, idx)}
				<mark class="ui-tree__mark">{text.slice(idx, idx + q.length)}</mark>
				{text.slice(idx + q.length)}
			</>
		);
	};

	const renderRow = (fn: FlatTreeNode<T>, offset?: number): VNode => {
		const key = fn.node.key;
		const selected = selectedKeys.value.has(key);
		const checked = checkedKeys.value.has(key);
		const indeterminate = !checked && anyDescendantChecked(fn.node, checkedKeys.value);
		const focused = (focusKey.value ?? flat.value[0]?.node.key) === key;
		const drop = dropTarget.value?.key === key ? dropTarget.value.position : null;

		return (
			<div
				role="treeitem"
				aria-level={fn.level + 1}
				aria-posinset={fn.posInSet}
				aria-setsize={fn.setSize}
				aria-expanded={fn.expandable ? fn.expanded : undefined}
				aria-selected={selectionMode ? selected : undefined}
				aria-checked={checkbox ? (indeterminate ? "mixed" : checked) : undefined}
				tabIndex={focused ? 0 : -1}
				data-index={offset}
				ref={offset !== undefined ? virtual.measureElement : undefined}
				draggable={dragdrop || undefined}
				class={cx(
					"ui-tree__node",
					selected && "ui-tree__node--selected",
					focused && "ui-tree__node--focused",
					drop && `ui-tree__node--drop-${drop}`,
					fn.node.class,
				)}
				style={styleVars({ "--ui-tree-indent": String(fn.level) })}
				onFocus={() => (focusKey.value = key)}
				onClick={() => !checkbox && selectRow(fn.node, false)}
				onContextMenu={(e) => handleContext(fn, e)}
				onDragStart={dragdrop ? () => (dragKey.value = key) : undefined}
				onDragOver={dragdrop
					? (e) => {
						e.preventDefault();
						dropTarget.value = { key, position: dropPositionFrom(e, fn.expandable) };
					}
					: undefined}
				onDragLeave={dragdrop
					? () => {
						if (dropTarget.value?.key === key) dropTarget.value = null;
					}
					: undefined}
				onDrop={dragdrop ? () => onDrop(fn) : undefined}
			>
				<span class="ui-tree__indent" aria-hidden="true" />
				{fn.expandable
					? (
						<button
							type="button"
							class="ui-tree__toggle"
							tabIndex={-1}
							aria-label={fn.expanded ? "Collapse" : "Expand"}
							onClick={(e) => {
								e.stopPropagation();
								toggleExpand(fn);
							}}
						>
							{togglerTemplate
								? togglerTemplate(fn.node, fn.expanded)
								: <Icon name="caret-right" class="ui-tree__toggle-icon" />}
						</button>
					)
					: <span class="ui-tree__toggle ui-tree__toggle--placeholder" aria-hidden="true" />}

				{checkbox && (
					<input
						type="checkbox"
						class="ui-tree__checkbox"
						tabIndex={-1}
						checked={checked}
						aria-label={`Select ${defaultLabel(fn.node)}`}
						ref={(el) => {
							if (el) el.indeterminate = indeterminate;
						}}
						onClick={(e) => e.stopPropagation()}
						onChange={() => toggleCheck(fn.node)}
					/>
				)}

				{fn.node.icon && <span class="ui-tree__icon" aria-hidden="true">{fn.node.icon}</span>}

				<span class="ui-tree__label">
					{nodeTemplate ? nodeTemplate(fn.node) : highlight(defaultLabel(fn.node))}
				</span>

				{contextMenuTemplate && contextKey.value === key && (
					<span class="ui-tree__context">{contextMenuTemplate(fn.node)}</span>
				)}
			</div>
		);
	};
	// #endregion

	const bodyStyle = useWindow ? undefined : styleVars({
		"--ui-tree-body-h": scrollHeight === "flex" ? undefined : (scrollHeight ?? undefined),
	});
	const isEmpty = flat.value.length === 0;

	// #region Render
	return (
		<div id={rootId} class={cx("ui-tree", scrollHeight === "flex" && "ui-tree--flex", className)}>
			{filter && (
				<div class="ui-tree__filter">
					<input
						type="text"
						class="ui-tree__filter-input"
						placeholder={filterPlaceholder}
						aria-label={filterPlaceholder}
						aria-controls={`${rootId}-tree`}
						value={query.value}
						onInput={(e) => (query.value = e.currentTarget.value)}
					/>
				</div>
			)}
			<div
				ref={parentRef}
				id={`${rootId}-tree`}
				role="tree"
				aria-label={ariaLabel}
				aria-multiselectable={selectionMode === "multiple" || checkbox || undefined}
				class={cx(
					"ui-tree__list",
					!useWindow && "ui-tree__list--scroll",
					virtualScroll && "ui-tree__list--virtual",
				)}
				style={bodyStyle}
				onKeyDown={onKeyDown}
			>
				{isEmpty && <div class="ui-tree__empty">{emptyTemplate ? emptyTemplate() : "No nodes"}
				</div>}

				{!isEmpty && virtualScroll
					? (
						<div
							class="ui-tree__sizer"
							style={styleVars({ "--v-total": `${virtual.totalSize}px` })}
						>
							{virtual.virtualItems.map((vi) => (
								<div class="ui-tree__virtual-row" style={styleVars({ "--v-top": `${vi.start}px` })}>
									{renderRow(flat.value[vi.index], vi.index)}
								</div>
							))}
						</div>
					)
					: !isEmpty
					? flat.value.map((fn) =>
						renderRow(fn)
					)
					: null}
			</div>
		</div>
	);
	// #endregion
}
