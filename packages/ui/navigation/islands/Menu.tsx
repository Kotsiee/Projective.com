import type { ComponentChildren, JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/menu.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useListNavigation } from "../../hooks/useListNavigation.ts";
import type { Placement } from "../../types/mod.ts";
import type { MenuItem } from "../../types/mod.ts";
import {
	activate,
	edgeFocusable,
	hasChildren,
	isSeparator,
	itemKey,
	typeaheadIndex,
	visibleItems,
} from "../core/menu.ts";

// #region Props
/** Props for {@link Menu}. */
export interface MenuProps {
	/** Vertical list of command items. A child with `items` renders as an inline group (label + rows). */
	model: MenuItem[];
	/**
	 * Popup mode — the list is hidden until its trigger is activated, anchored to the trigger with
	 * `useFloating` and closed on outside-pointer/Escape via `useDismiss`. When omitted the list is a
	 * static inline block.
	 */
	popup?: boolean;
	/** Trigger content for popup mode (defaults to a "⋯" button). Ignored when inline. */
	trigger?: ComponentChildren;
	/** Accessible label for the trigger (popup) — defaults to `"Menu"`. */
	triggerLabel?: string;
	/** Anchored placement for the popup panel (default `"bottom-start"`). */
	placement?: Placement;
	/** Custom renderer for an item's inner content (icon/label/badge/shortcut). */
	itemTemplate?: (item: MenuItem) => VNode;
	/** Accessible label for the menu list. */
	"aria-label"?: string;
	class?: string;
}
// #endregion

// #region Render model
type Row =
	| { kind: "separator"; key: string }
	| { kind: "group"; key: string; label: string }
	| { kind: "item"; key: string; item: MenuItem; index: number };

/** Flatten `model` into a linear row list, hoisting group children inline and indexing focusables. */
function buildRows(model: MenuItem[]): { rows: Row[]; items: MenuItem[] } {
	const rows: Row[] = [];
	const items: MenuItem[] = [];
	const push = (item: MenuItem, ki: string) => {
		const index = items.length;
		items.push(item);
		rows.push({ kind: "item", key: ki, item, index });
	};
	visibleItems(model).forEach((top, ti) => {
		if (isSeparator(top)) {
			rows.push({ kind: "separator", key: `sep-${ti}` });
			return;
		}
		if (hasChildren(top)) {
			if (top.label) rows.push({ kind: "group", key: `grp-${ti}`, label: top.label });
			visibleItems(top.items).forEach((child, ci) => {
				if (isSeparator(child)) rows.push({ kind: "separator", key: `sep-${ti}-${ci}` });
				else push(child, itemKey(child, ci));
			});
			return;
		}
		push(top, itemKey(top, ti));
	});
	return { rows, items };
}
// #endregion

/**
 * Menu — a vertical list of {@link MenuItem}s in either a static inline block or an anchored popup.
 * Children with `items` render as inline groups (a non-interactive label followed by their rows).
 * WAI-ARIA `menu`/`menuitem` with a roving highlight: Up/Down move (skipping separators, disabled
 * rows and group labels), Home/End jump, printable keys typeahead, Enter/Space activate the item's
 * `command` or follow its `url`, and Escape closes a popup. Reduced-motion collapses the open
 * animation. Icons, trailing `badge`s, `shortcut` hints, and `disabled` states are all honoured.
 */
export function Menu(props: MenuProps): JSX.Element {
	const {
		model,
		popup = false,
		trigger,
		triggerLabel = "Menu",
		placement = "bottom-start",
		itemTemplate,
		class: className,
		"aria-label": ariaLabel,
	} = props;

	const rootId = useId(undefined, "menu");
	const listId = `${rootId}-list`;
	const open = useSignal(!popup);
	const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	const { rows, items } = buildRows(model);
	const nav = useListNavigation(() => items.length, (i) => !!items[i]?.disabled);

	const floating = useFloating({
		open: popup && open.value,
		triggerRef,
		panelRef,
		placement,
	});
	useDismiss({
		open: popup && open.value,
		onDismiss: () => closePanel(),
		panelRef,
		triggerRef,
	});

	// #region Open / close
	const focusList = () => queueMicrotask(() => listRef.current?.focus());
	const openPanel = () => {
		open.value = true;
		nav.reset(edgeFocusable(items, "first"));
		focusList();
	};
	const closePanel = () => {
		if (!popup) return;
		open.value = false;
		nav.reset(-1);
		triggerRef.current?.focus();
	};
	const toggle = () => (open.value ? closePanel() : openPanel());
	// #endregion

	// #region Activation
	const activateAt = (index: number, e: Event) => {
		const item = items[index];
		if (!item || item.disabled) return;
		if (item.url) {
			closePanel();
			return; // anchor handles navigation natively
		}
		if (activate(item, e)) closePanel();
	};
	// #endregion

	// #region Keyboard
	const onTypeahead = (key: string) => {
		const now = Date.now();
		const t = typeahead.current;
		t.buffer = now - t.at > 700 ? key : t.buffer + key;
		t.at = now;
		const found = typeaheadIndex(items, nav.active.peek(), t.buffer);
		if (found >= 0) nav.reset(found);
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>) => {
		if (nav.onKeyDown(e as unknown as KeyboardEvent)) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			if (nav.active.peek() >= 0) activateAt(nav.active.peek(), e as unknown as Event);
			return;
		}
		if (e.key === "Escape" && popup) {
			e.preventDefault();
			closePanel();
			return;
		}
		if (e.key === "Tab" && popup) closePanel();
		if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			onTypeahead(e.key);
		}
	};
	// #endregion

	const activeIdx = nav.active.value;
	const activeDescendant = activeIdx >= 0 ? `${rootId}-item-${activeIdx}` : undefined;

	// #region Row renderer
	const renderItem = (item: MenuItem, index: number): VNode => {
		const active = index === activeIdx;
		const content = itemTemplate ? itemTemplate(item) : (
			<>
				{item.icon && <span class="ui-menu__icon" aria-hidden="true">{item.icon}</span>}
				<span class="ui-menu__label">{item.label}</span>
				{item.shortcut && <span class="ui-menu__shortcut" aria-hidden="true">{item.shortcut}</span>}
				{item.badge != null && <span class="ui-menu__badge">{item.badge}</span>}
			</>
		);
		const cls = cx(
			"ui-menu__item",
			active && "ui-menu__item--active",
			item.disabled && "ui-menu__item--disabled",
			item.active && "ui-menu__item--current",
			item.class,
		);
		const shared = {
			id: `${rootId}-item-${index}`,
			role: "menuitem" as const,
			class: cls,
			"aria-disabled": item.disabled || undefined,
			"aria-current": item.active || undefined,
			tabIndex: -1,
			onPointerMove: () => nav.reset(index),
		};
		if (item.url && !item.disabled) {
			return (
				<a
					{...shared}
					href={item.url}
					target={item.target}
					onClick={(e: Event) => activateAt(index, e)}
				>
					{content}
				</a>
			);
		}
		return (
			<div
				{...shared}
				onClick={(e: Event) => !item.disabled && activateAt(index, e)}
			>
				{content}
			</div>
		);
	};

	const list = (
		<ul
			ref={listRef}
			id={listId}
			role="menu"
			class="ui-menu__list"
			aria-label={ariaLabel ?? (popup ? triggerLabel : undefined)}
			aria-activedescendant={activeDescendant}
			tabIndex={popup ? 0 : 0}
			onKeyDown={onKeyDown}
		>
			{rows.map((row) => {
				if (row.kind === "separator") {
					return <li key={row.key} role="separator" class="ui-menu__separator" />;
				}
				if (row.kind === "group") {
					return (
						<li key={row.key} role="presentation" class="ui-menu__group-label">{row.label}</li>
					);
				}
				return (
					<li key={row.key} role="none" class="ui-menu__row">
						{renderItem(row.item, row.index)}
					</li>
				);
			})}
		</ul>
	);
	// #endregion

	if (!popup) {
		return <nav class={cx("ui-menu", className)} aria-label={ariaLabel}>{list}</nav>;
	}

	return (
		<span class={cx("ui-menu", "ui-menu--popup", className)}>
			<button
				ref={triggerRef}
				type="button"
				class="ui-menu__trigger"
				aria-haspopup="menu"
				aria-expanded={open.value}
				aria-controls={listId}
				aria-label={triggerLabel}
				onClick={toggle}
				onKeyDown={(e) => {
					if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !open.value) {
						e.preventDefault();
						openPanel();
					}
				}}
			>
				{trigger ?? <span aria-hidden="true">⋯</span>}
			</button>
			{open.value && (
				<div
					ref={panelRef}
					class={cx(
						"ui-menu__panel",
						floating?.placement.startsWith("top") && "ui-menu__panel--top",
					)}
					style={floating
						? styleVars({
							"--float-top": `${floating.top}px`,
							"--float-left": `${floating.left}px`,
						})
						: undefined}
				>
					{list}
				</div>
			)}
		</span>
	);
}
