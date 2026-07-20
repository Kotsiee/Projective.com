import type { JSX, VNode } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import "../styles/tree-nav.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";

/**
 * TreeNav — a standard tree-explorer navigation sidebar: a hierarchical list of disclosure nodes with
 * **chevron** open/close affordances (never triangles), optional leading icon OR avatar per node
 * (freelancer profile pictures at the top level), a muted trailing count, and an icon-only status slot.
 * Purpose-built for wayfinding (selecting a node scopes a workspace) rather than data editing — it is
 * lighter than {@link Tree}: no checkboxes, drag-drop, or virtualization, just clean expand/collapse +
 * selection with the enterprise look (borderless rows, tonal hover, a tonal active tint).
 *
 * Signal-first + controllable: `selectedKey` is parent-owned (the host scopes the workspace to it);
 * `expanded` may be a parent `Signal<Set<string>>` (fully controlled — the host can auto-expand the
 * deep-linked node's ancestors) or omitted for internal state seeded by `defaultExpanded`. Clicking a
 * row selects it (and expands a branch); clicking the chevron toggles expansion only. §B.4: no boxing —
 * a single-hairline vertical divider between the tree and the workspace is the host's concern. Token-only,
 * ARIA `role="tree"`/`treeitem` with `aria-level`/`aria-expanded`/`aria-selected`, keyboard arrows +
 * Enter/Space, reduced-motion aware. Dumb island: no data access.
 */

// #region Model
/** One node of a {@link TreeNav}. `key` must be stable + unique across the whole tree. */
export interface TreeNavNode {
	key: string;
	label: string;
	/** A muted secondary line under the label. */
	sublabel?: string | null;
	/** Leading icon (folder/stage/…); ignored when `avatar` is set. */
	icon?: VNode;
	/** Leading circular avatar (submitter profile picture); wins over `icon`. */
	avatar?: { image?: string | null; label: string } | null;
	/** Trailing icon-only status glyph (e.g. a review-status mark). */
	status?: VNode | null;
	/** Muted trailing file/child count. */
	count?: number | null;
	children?: TreeNavNode[];
	disabled?: boolean;
}

export interface TreeNavProps {
	nodes: TreeNavNode[];
	/** The selected node key (parent-owned — scopes the host workspace). */
	selectedKey?: string | null;
	onSelect?: (node: TreeNavNode) => void;
	/** Controlled expanded-key set. Omit for internal state seeded by {@link defaultExpanded}. */
	expanded?: Signal<Set<string>>;
	/** Initially-expanded keys (used only when `expanded` is omitted). */
	defaultExpanded?: string[];
	onToggle?: (node: TreeNavNode, expanded: boolean) => void;
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Glyphs
/** The disclosure chevron — a right-pointing `›` that rotates to point down when expanded (via CSS). */
function Chevron(): JSX.Element {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
			<path
				d="M6 4l4 4-4 4"
				stroke="currentColor"
				stroke-width="1.7"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

/** First-letter (or two-initials) fallback for an avatar with no image. */
function initials(label: string): string {
	const parts = label.trim().split(/\s+/);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
// #endregion

export function TreeNav(props: TreeNavProps): JSX.Element {
	const {
		nodes,
		selectedKey = null,
		onSelect,
		expanded: controlledExpanded,
		defaultExpanded,
		onToggle,
		"aria-label": ariaLabel = "Navigation tree",
		class: className,
	} = props;

	const internalExpanded = useSignal<Set<string>>(new Set(defaultExpanded ?? []));
	const expanded = controlledExpanded ?? internalExpanded;
	// Roving tabindex — the tree is a SINGLE tab stop (APG tree pattern): exactly one row is tabbable
	// (the last-focused, else the selected, else the first/root row, all of which are always rendered),
	// and Arrow/Home/End move focus between rows. `onFocus` re-homes the tab stop to the focused row.
	const focusedKey = useSignal<string | null>(null);
	const rovingKey = focusedKey.value ?? selectedKey ?? nodes[0]?.key ?? null;

	const isExpanded = (key: string) => expanded.value.has(key);

	const setExpanded = (key: string, open: boolean, node: TreeNavNode) => {
		const next = new Set(expanded.value);
		if (open) next.add(key);
		else next.delete(key);
		expanded.value = next;
		onToggle?.(node, open);
	};
	const toggle = (node: TreeNavNode) => setExpanded(node.key, !isExpanded(node.key), node);

	const selectNode = (node: TreeNavNode) => {
		if (node.disabled) return;
		// Selecting a branch also opens it, so the workspace scope + the visible tree agree.
		if (node.children && node.children.length > 0 && !isExpanded(node.key)) {
			setExpanded(node.key, true, node);
		}
		onSelect?.(node);
	};

	// #region Keyboard (roving over the flattened visible rows)
	const rowSelector = ".ui-treenav__row";
	const rowsIn = (root: HTMLElement | null) =>
		Array.from(root?.querySelectorAll<HTMLButtonElement>(rowSelector) ?? []);

	const onKeyDown = (node: TreeNavNode, hasChildren: boolean) =>
	(e: JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
		const root = e.currentTarget.closest<HTMLElement>(".ui-treenav");
		const rows = rowsIn(root);
		const i = rows.indexOf(e.currentTarget);
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				rows[Math.min(rows.length - 1, i + 1)]?.focus();
				break;
			case "ArrowUp":
				e.preventDefault();
				rows[Math.max(0, i - 1)]?.focus();
				break;
			case "ArrowRight":
				e.preventDefault();
				if (hasChildren && !isExpanded(node.key)) setExpanded(node.key, true, node);
				else if (hasChildren) rows[i + 1]?.focus();
				break;
			case "ArrowLeft":
				e.preventDefault();
				if (hasChildren && isExpanded(node.key)) setExpanded(node.key, false, node);
				break;
			case "Home":
				e.preventDefault();
				rows[0]?.focus();
				break;
			case "End":
				e.preventDefault();
				rows[rows.length - 1]?.focus();
				break;
		}
	};
	// #endregion

	// #region Row
	const renderNode = (node: TreeNavNode, level: number): JSX.Element => {
		const hasChildren = !!node.children && node.children.length > 0;
		const open = hasChildren && isExpanded(node.key);
		const selected = node.key === selectedKey;

		return (
			<li
				key={node.key}
				class="ui-treenav__item"
				role="treeitem"
				aria-level={level + 1}
				aria-expanded={hasChildren ? open : undefined}
				aria-selected={selected}
			>
				<div class="ui-treenav__rowwrap" style={styleVars({ "--treenav-depth": String(level) })}>
					<button
						type="button"
						class={cx(
							"ui-treenav__row",
							selected && "ui-treenav__row--active",
							node.disabled && "ui-treenav__row--disabled",
						)}
						data-kind={hasChildren ? "branch" : "leaf"}
						disabled={node.disabled}
						aria-current={selected ? "true" : undefined}
						tabIndex={node.key === rovingKey ? 0 : -1}
						title={node.label}
						onClick={() => selectNode(node)}
						onFocus={() => (focusedKey.value = node.key)}
						onKeyDown={onKeyDown(node, hasChildren)}
					>
						<span
							class="ui-treenav__chevron"
							data-open={open ? "true" : undefined}
							data-hidden={hasChildren ? undefined : "true"}
							onClick={hasChildren
								? (e: JSX.TargetedMouseEvent<HTMLSpanElement>) => {
									e.stopPropagation();
									toggle(node);
								}
								: undefined}
							aria-hidden="true"
						>
							<Chevron />
						</span>

						<span class="ui-treenav__lead" aria-hidden="true">
							{node.avatar
								? (node.avatar.image
									? (
										<img
											class="ui-treenav__avatar"
											src={node.avatar.image}
											alt=""
											loading="lazy"
											draggable={false}
										/>
									)
									: (
										<span class="ui-treenav__avatar ui-treenav__avatar--initials">
											{initials(node.avatar.label)}
										</span>
									))
								: node.icon
								? <span class="ui-treenav__icon">{node.icon}</span>
								: <span class="ui-treenav__icon ui-treenav__icon--placeholder" />}
						</span>

						<span class="ui-treenav__text">
							<span class="ui-treenav__label">{node.label}</span>
							{node.sublabel
								? <span class="ui-treenav__sublabel">{node.sublabel}</span>
								: null}
						</span>

						{node.status ? <span class="ui-treenav__status">{node.status}</span> : null}
						{typeof node.count === "number"
							? <span class="ui-treenav__count">{node.count}</span>
							: null}
					</button>
				</div>

				{hasChildren && open
					? (
						<ul class="ui-treenav__group" role="group">
							{node.children!.map((child) => renderNode(child, level + 1))}
						</ul>
					)
					: null}
			</li>
		);
	};
	// #endregion

	return (
		<ul class={cx("ui-treenav", className)} role="tree" aria-label={ariaLabel}>
			{nodes.map((n) => renderNode(n, 0))}
		</ul>
	);
}
