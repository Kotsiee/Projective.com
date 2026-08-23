import type { JSX } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/treeselect.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { useFloating } from "../hooks/useFloating.ts";
import { useDismiss } from "../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

// #region Types
/** A node in the {@link TreeSelect} hierarchy. */
export interface TreeNode {
	/** Stable unique key (the selection value). */
	key: string;
	/** Visible label. */
	label: string;
	/** Child nodes (a branch when present). */
	children?: TreeNode[];
	/** Optional leading icon token/name. */
	icon?: string;
	/** Disable selection of this node. */
	disabled?: boolean;
}

/** Selection strategy: single value, multi-select, or checkbox with parent/child propagation. */
export type TreeSelectionMode = "single" | "multiple" | "checkbox";

export interface TreeSelectProps extends BaseFieldProps {
	/** The tree data. */
	options?: TreeNode[];
	/** Selected key(s) — `string` (single) or `string[]` (multiple/checkbox). Raw or `Signal`. */
	value?: Bindable<string | string[]>;
	/** Fired whenever the selection changes. */
	onValueChange?: ValueChange<string | string[]>;
	/** Selection mode (default `single`). */
	selectionMode?: TreeSelectionMode;
	/** Trigger placeholder when nothing is selected. */
	placeholder?: string;
	/** Show a label filter box at the top of the panel. */
	filter?: boolean;
	class?: string;
}

interface VisibleRow {
	node: TreeNode;
	level: number;
	hasChildren: boolean;
}
// #endregion

/**
 * TreeSelect — a combobox trigger opening a floating, expandable tree (PrimeNG parity). Supports
 * `single`, `multiple`, and `checkbox` selection; in checkbox mode toggling a branch propagates to
 * all descendants and a partially-selected branch renders `aria-checked="mixed"`. Implements the
 * WAI-ARIA tree pattern (`role="tree"`/`treeitem`, `aria-level`, `aria-expanded`,
 * `aria-selected`/`aria-checked`) with arrow-key traversal, expand/collapse, an optional label
 * filter, and outside/Escape dismissal.
 *
 * The PANEL is projected into `document.body` via {@link BodyPortal} and claims a live stacking index
 * from {@link useOverlayStack}, so it escapes any ancestor that would clip it (`overflow: hidden`) or
 * re-base its `position: fixed` (`transform`/`filter`/`backdrop-filter`) — the trap a Dialog panel
 * sets. The trigger stays in place and the id-based ARIA wiring survives the move.
 */
export function TreeSelect(props: TreeSelectProps): JSX.Element {
	const {
		options = [],
		value,
		onValueChange,
		selectionMode = "single",
		placeholder,
		filter,
		id,
		name,
		disabled,
		readOnly,
		required,
		status = "default",
		size = "md",
		fluid,
		class: className,
		...aria
	} = props;

	const mode = selectionMode;
	const ctrl = useControllable<string | string[]>(
		value,
		mode === "single" ? "" : [],
		onValueChange,
	);

	const rootId = useId(id, "treeselect");
	const panelId = `${rootId}-panel`;
	const treeId = `${rootId}-tree`;

	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const treeRef = useRef<HTMLDivElement>(null);

	const open = useMemo(() => signal(false), []);
	const active = useMemo(() => signal<string | null>(null), []);
	const expanded = useMemo(() => signal<Set<string>>(new Set()), []);
	const filterText = useMemo(() => signal(""), []);

	// #region Tree indexing
	const index = useMemo(() => {
		const byKey: Record<string, TreeNode> = {};
		const parent: Record<string, string | undefined> = {};
		const walk = (nodes: TreeNode[], p?: string) => {
			for (const node of nodes) {
				byKey[node.key] = node;
				parent[node.key] = p;
				if (node.children?.length) walk(node.children, node.key);
			}
		};
		walk(options);
		return { byKey, parent };
	}, [options]);

	const leavesOf = (node: TreeNode): string[] =>
		node.children?.length ? node.children.flatMap(leavesOf) : [node.key];
	const subtreeKeys = (
		node: TreeNode,
	): string[] => [node.key, ...(node.children?.length ? node.children.flatMap(subtreeKeys) : [])];
	// #endregion

	const stack = useOverlayStack({ active: open.value, layer: "popover" });
	const float = useFloating({ open: open.value, triggerRef, panelRef, placement: "bottom-start" });
	// `enabled` gates the ESCAPE channel only, and that channel is exclusive (its handler calls
	// `stopImmediatePropagation`). Every listener registers on `document` in the capture phase, so
	// they run in registration order, not stacking order — without this an open TreeSelect under a
	// later overlay eats that overlay's Escape. Outside-pointer dismissal is governed by containment
	// and stays live regardless.
	useDismiss({
		open: open.value,
		enabled: stack.isTop,
		onDismiss: () => close(),
		panelRef,
		triggerRef,
	});

	// #region Open / close
	const openPanel = () => {
		if (disabled || readOnly) return;
		open.value = true;
		active.value = firstVisibleKey();
		queueMicrotask(() => treeRef.current?.focus());
	};
	const close = () => {
		open.value = false;
	};
	const toggleOpen = () => (open.value ? close() : openPanel());
	// #endregion

	// #region Expansion
	const isExpanded = (key: string): boolean => {
		if (filterText.value) return matchInSubtree(index.byKey[key]);
		return expanded.value.has(key);
	};
	const setExpanded = (key: string, next: boolean) => {
		const set = new Set(expanded.value);
		if (next) set.add(key);
		else set.delete(key);
		expanded.value = set;
	};
	// #endregion

	// #region Filtering + visible rows
	const matchInSubtree = (node: TreeNode | undefined): boolean => {
		if (!node) return false;
		const q = filterText.value.trim().toLowerCase();
		if (!q) return true;
		if (node.label.toLowerCase().includes(q)) return true;
		return !!node.children?.some(matchInSubtree);
	};

	const visibleRows = useMemo<VisibleRow[]>(() => {
		const out: VisibleRow[] = [];
		const build = (nodes: TreeNode[], level: number) => {
			for (const node of nodes) {
				if (filterText.value && !matchInSubtree(node)) continue;
				const hasChildren = !!node.children?.length;
				out.push({ node, level, hasChildren });
				if (hasChildren && isExpanded(node.key)) build(node.children!, level + 1);
			}
		};
		build(options, 1);
		return out;
	}, [options, expanded.value, filterText.value]);

	const firstVisibleKey = (): string | null => visibleRows[0]?.node.key ?? null;
	// #endregion

	// #region Selection
	const selectedArr = (): string[] => {
		const v = ctrl.get();
		return Array.isArray(v) ? v : [];
	};
	const selectedSet = new Set(selectedArr());

	const selectNode = (node: TreeNode) => {
		if (node.disabled) return;
		if (mode === "single") {
			ctrl.set(node.key);
			close();
			triggerRef.current?.focus();
			return;
		}
		if (mode === "multiple") {
			const set = new Set(selectedArr());
			set.has(node.key) ? set.delete(node.key) : set.add(node.key);
			ctrl.set([...set]);
			return;
		}
		toggleCheckbox(node);
	};

	const toggleCheckbox = (node: TreeNode) => {
		const set = new Set(selectedArr());
		const target = !set.has(node.key);
		for (const k of subtreeKeys(node)) {
			target ? set.add(k) : set.delete(k);
		}
		// Reconcile ancestors: a branch is checked iff every child is checked.
		let p = index.parent[node.key];
		while (p) {
			const parentNode = index.byKey[p];
			const allChecked = (parentNode.children ?? []).every((c) => set.has(c.key));
			allChecked ? set.add(p) : set.delete(p);
			p = index.parent[p];
		}
		ctrl.set([...set]);
	};

	const checkState = (node: TreeNode): "true" | "false" | "mixed" => {
		if (selectedSet.has(node.key)) return "true";
		const leaves = leavesOf(node);
		const some = leaves.some((k) => selectedSet.has(k));
		return some ? "mixed" : "false";
	};

	const isSelected = (node: TreeNode): boolean => {
		if (mode === "single") return ctrl.get() === node.key;
		return selectedSet.has(node.key);
	};
	// #endregion

	// #region Keyboard
	const moveTo = (i: number) => {
		const row = visibleRows[i];
		if (row) active.value = row.node.key;
	};
	const onTreeKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const rows = visibleRows;
		const idx = rows.findIndex((r) => r.node.key === active.value);
		const cur = idx >= 0 ? rows[idx] : undefined;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				moveTo(Math.min(idx + 1, rows.length - 1));
				break;
			case "ArrowUp":
				e.preventDefault();
				moveTo(Math.max(idx - 1, 0));
				break;
			case "Home":
				e.preventDefault();
				moveTo(0);
				break;
			case "End":
				e.preventDefault();
				moveTo(rows.length - 1);
				break;
			case "ArrowRight":
				if (!cur) break;
				e.preventDefault();
				if (cur.hasChildren && !isExpanded(cur.node.key)) setExpanded(cur.node.key, true);
				else if (cur.hasChildren) moveTo(idx + 1);
				break;
			case "ArrowLeft":
				if (!cur) break;
				e.preventDefault();
				if (cur.hasChildren && isExpanded(cur.node.key)) setExpanded(cur.node.key, false);
				else {
					const p = index.parent[cur.node.key];
					if (p) active.value = p;
				}
				break;
			case "Enter":
			case " ":
				if (!cur) break;
				e.preventDefault();
				selectNode(cur.node);
				break;
			case "Escape":
				e.preventDefault();
				close();
				triggerRef.current?.focus();
				break;
			case "Tab":
				close();
				break;
		}
	};
	// #endregion

	// #region Trigger label
	const triggerLabel = (): string => {
		if (mode === "single") {
			const k = ctrl.signal.value;
			return typeof k === "string" && k ? index.byKey[k]?.label ?? "" : "";
		}
		const chosen = selectedArr().filter((k) => index.byKey[k] && !index.byKey[k].children?.length);
		if (chosen.length === 0) return "";
		if (chosen.length <= 2) return chosen.map((k) => index.byKey[k]?.label).join(", ");
		return `${chosen.length} selected`;
	};
	// #endregion

	const label = triggerLabel();
	const activeDescId = active.value ? `${treeId}-node-${active.value}` : undefined;

	const renderRow = (row: VisibleRow) => {
		const { node, level, hasChildren } = row;
		const nodeId = `${treeId}-node-${node.key}`;
		const isActive = active.value === node.key;
		const selected = isSelected(node);
		const check = mode === "checkbox" ? checkState(node) : undefined;
		return (
			<div
				key={node.key}
				id={nodeId}
				role="treeitem"
				aria-level={level}
				aria-expanded={hasChildren ? isExpanded(node.key) : undefined}
				aria-selected={mode !== "checkbox" ? selected : undefined}
				aria-checked={check === undefined ? undefined : check}
				aria-disabled={node.disabled || undefined}
				class={cx(
					"ui-treeselect__node",
					isActive && "ui-treeselect__node--active",
					selected && "ui-treeselect__node--selected",
					node.disabled && "ui-treeselect__node--disabled",
				)}
				style={styleVars({ "--ts-level": String(level) })}
				onClick={() => {
					active.value = node.key;
					selectNode(node);
				}}
			>
				{hasChildren
					? (
						<button
							type="button"
							class="ui-treeselect__toggle"
							tabIndex={-1}
							aria-label={isExpanded(node.key) ? "Collapse" : "Expand"}
							onClick={(e) => {
								e.stopPropagation();
								setExpanded(node.key, !isExpanded(node.key));
							}}
						>
							<span
								class={cx(
									"ui-treeselect__chevron",
									isExpanded(node.key) && "ui-treeselect__chevron--open",
								)}
								aria-hidden="true"
							/>
						</button>
					)
					: <span class="ui-treeselect__toggle ui-treeselect__toggle--leaf" aria-hidden="true" />}
				{mode === "checkbox" && (
					<span
						class={cx(
							"ui-treeselect__checkbox",
							check === "true" && "ui-treeselect__checkbox--checked",
							check === "mixed" && "ui-treeselect__checkbox--mixed",
						)}
						aria-hidden="true"
					/>
				)}
				<span class="ui-treeselect__label">{node.label}</span>
			</div>
		);
	};

	return (
		<div class={cx("ui-treeselect", fluid && "ui-treeselect--fluid", className)}>
			<button
				ref={triggerRef}
				type="button"
				id={rootId}
				name={name}
				class={cx(
					"ui-field",
					"ui-treeselect__trigger",
					...fieldModifiers("ui-field", {
						size,
						status,
						fluid,
						disabled,
						readOnly,
						open: open.value,
					}),
				)}
				disabled={disabled}
				aria-haspopup="tree"
				aria-expanded={open.value}
				aria-controls={panelId}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				onClick={toggleOpen}
				{...aria}
			>
				<span class={cx("ui-treeselect__value", !label && "ui-treeselect__value--placeholder")}>
					{label || placeholder || " "}
				</span>
				<span class="ui-treeselect__arrow" aria-hidden="true" />
			</button>

			{open.value && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={panelId}
						class="ui-treeselect__panel"
						data-placement={float?.placement}
						style={styleVars({
							"--ts-top": float ? `${float.top}px` : undefined,
							"--ts-left": float ? `${float.left}px` : undefined,
							"--ts-width": float ? `${float.width}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						{filter && (
							<div class="ui-treeselect__filter">
								<input
									type="text"
									class="ui-treeselect__filter-input"
									placeholder="Filter"
									value={filterText.value}
									aria-label="Filter nodes"
									onInput={(e) => (filterText.value = e.currentTarget.value)}
								/>
							</div>
						)}
						<div
							ref={treeRef}
							id={treeId}
							role="tree"
							tabIndex={0}
							aria-multiselectable={mode !== "single" || undefined}
							aria-activedescendant={activeDescId}
							class="ui-treeselect__tree"
							onKeyDown={onTreeKeyDown}
						>
							{visibleRows.length === 0
								? <div class="ui-treeselect__empty">No results</div>
								: visibleRows.map(renderRow)}
						</div>
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
