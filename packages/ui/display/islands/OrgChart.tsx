import type { JSX, VNode } from "preact";
import "../styles/orgchart.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import type { Bindable } from "../../fields/types/mod.ts";
import type { TreeNode } from "../../types/mod.ts";

// #region Types
/** Props for {@link OrgChart}. */
export interface OrgChartProps<T = unknown> {
	/** Root of the node hierarchy (single root; wrap multiple roots under a synthetic parent). */
	value: TreeNode<T>;
	/** Custom node-card renderer; defaults to the node `label`. */
	nodeTemplate?: (node: TreeNode<T>) => VNode | string;
	/** Allow expand/collapse of nodes that have children (default true). */
	collapsible?: boolean;
	/** Bound set of collapsed node keys (controlled expansion state). */
	collapsedKeys?: Bindable<string[]>;
	/** Fired when a node is expanded/collapsed, with the next collapsed-key set. */
	onToggle?: (keys: string[]) => void;
	/** Enable node selection (single-select). */
	selectable?: boolean;
	/** Bound selected node keys. */
	selectionKeys?: Bindable<string[]>;
	/** Fired when the selection changes. */
	onSelectionChange?: (keys: string[]) => void;
	/** Accessible label for the tree. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * OrgChart — a top-down hierarchy of node cards over a {@link TreeNode} tree, connected by CSS
 * connector lines. Each node with children is expandable/collapsible (controlled via `collapsedKeys`)
 * and nodes are optionally single-selectable. The tree centres horizontally and scrolls inside its
 * own container on overflow. Exposes WAI-ARIA `tree`/`treeitem` semantics with `aria-expanded` /
 * `aria-selected`; keyboard: Arrow Left/Right collapse/expand, Enter/Space select, Arrow Up/Down move
 * focus between visible cards.
 */
export function OrgChart<T = unknown>(props: OrgChartProps<T>): JSX.Element {
	const {
		value,
		nodeTemplate,
		collapsible = true,
		collapsedKeys,
		onToggle,
		selectable = false,
		selectionKeys,
		onSelectionChange,
		"aria-label": ariaLabel,
		class: className,
	} = props;

	const collapsedCtrl = useControllable<string[]>(collapsedKeys, [], onToggle);
	const selectionCtrl = useControllable<string[]>(selectionKeys, [], onSelectionChange);

	const collapsed = collapsedCtrl.signal.value;
	const selection = selectionCtrl.signal.value;

	// #region State helpers
	const isCollapsed = (key: string) => collapsed.includes(key);
	const isSelected = (key: string) => selection.includes(key);

	const toggle = (key: string) => {
		if (!collapsible) return;
		const next = isCollapsed(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key];
		collapsedCtrl.set(next);
	};

	const select = (node: TreeNode<T>) => {
		if (!selectable || node.selectable === false) return;
		selectionCtrl.set(isSelected(node.key) ? [] : [node.key]);
	};
	// #endregion

	// #region Keyboard
	const onCardKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, node: TreeNode<T>, hasKids: boolean) => {
		switch (e.key) {
			case "ArrowRight":
				if (hasKids && isCollapsed(node.key)) {
					e.preventDefault();
					toggle(node.key);
				}
				break;
			case "ArrowLeft":
				if (hasKids && !isCollapsed(node.key)) {
					e.preventDefault();
					toggle(node.key);
				}
				break;
			case "ArrowDown":
			case "ArrowUp": {
				e.preventDefault();
				const cards = Array.from(
					(e.currentTarget.closest(".ui-orgchart")?.querySelectorAll<HTMLElement>(
						".ui-orgchart__card",
					)) ?? [],
				);
				const i = cards.indexOf(e.currentTarget);
				const next = e.key === "ArrowDown" ? cards[i + 1] : cards[i - 1];
				next?.focus();
				break;
			}
			case "Enter":
			case " ":
				if (selectable) {
					e.preventDefault();
					select(node);
				}
				break;
		}
	};
	// #endregion

	// #region Recursive render
	const renderNode = (node: TreeNode<T>): VNode => {
		const kids = node.children ?? [];
		const hasKids = kids.length > 0;
		const showKids = hasKids && !isCollapsed(node.key);

		return (
			<li
				key={node.key}
				class={cx("ui-orgchart__node", node.class)}
				role="treeitem"
				aria-expanded={hasKids ? !isCollapsed(node.key) : undefined}
				aria-selected={selectable ? isSelected(node.key) : undefined}
			>
				<div
					class={cx(
						"ui-orgchart__subtree",
						showKids && "ui-orgchart__subtree--has-children",
					)}
				>
					<span class="ui-orgchart__card-wrap">
						<div
							class={cx(
								"ui-orgchart__card",
								selectable && node.selectable !== false && "ui-orgchart__card--selectable",
								isSelected(node.key) && "ui-orgchart__card--selected",
							)}
							tabIndex={0}
							onClick={() => select(node)}
							onKeyDown={(e) => onCardKeyDown(e, node, hasKids)}
						>
							{nodeTemplate ? nodeTemplate(node) : (node.label ?? node.key)}
						</div>
						{collapsible && hasKids && (
							<button
								type="button"
								class="ui-orgchart__toggle"
								aria-label={isCollapsed(node.key) ? "Expand" : "Collapse"}
								aria-expanded={!isCollapsed(node.key)}
								onClick={(e) => {
									e.stopPropagation();
									toggle(node.key);
								}}
							>
								{isCollapsed(node.key) ? "+" : "−"}
							</button>
						)}
					</span>
					{showKids && (
						<ul class="ui-orgchart__children" role="group">
							{kids.map((child) => renderNode(child))}
						</ul>
					)}
				</div>
			</li>
		);
	};
	// #endregion

	return (
		<div class={cx("ui-orgchart", className)}>
			<ul class="ui-orgchart__tree" role="tree" aria-label={ariaLabel}>
				{renderNode(value)}
			</ul>
		</div>
	);
}
