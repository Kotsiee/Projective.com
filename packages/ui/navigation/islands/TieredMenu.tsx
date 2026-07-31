import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/tieredmenu.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import type { Placement } from "../../types/mod.ts";
import type { MenuItem } from "../../types/mod.ts";
import { activate, hasChildren, isSeparator, itemKey, visibleItems } from "../core/menu.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Props for {@link TieredMenu}. */
export interface TieredMenuProps {
	/** Root items; any item's `items` becomes a submenu that flies out to the side. Arbitrary depth. */
	model: MenuItem[];
	/** Popup mode — hidden until the trigger opens it; dismiss on outside-pointer/Escape. */
	popup?: boolean;
	/** Trigger content for popup mode (defaults to a "☰" button). */
	trigger?: VNode | string;
	/** Accessible label for the popup trigger / root menu (default `"Menu"`). */
	triggerLabel?: string;
	/** Custom item content renderer. */
	itemTemplate?: (item: MenuItem) => VNode;
	class?: string;
}

interface LevelProps {
	items: MenuItem[];
	idPrefix: string;
	root: boolean;
	itemTemplate?: (item: MenuItem) => VNode;
	/** Close the whole menu tree (Escape / activation). */
	onCloseAll: () => void;
	/** Return focus to the parent row (Left arrow from a non-root level). */
	onFocusParent?: () => void;
	ariaLabel?: string;
}
// #endregion

/**
 * One cascading level of a {@link TieredMenu}. Renders a vertical `role="menu"`; rows with children
 * advertise `aria-haspopup`/`aria-expanded` and open a side flyout (`useFloating`, `right-start`).
 * Roving DOM focus: Up/Down move, Home/End jump, Right opens a submenu and focuses its first row,
 * Left closes back to the parent, Enter/Space activate. Hover mirrors the keyboard open state.
 */
function TieredLevel(props: LevelProps): VNode {
	const { items, idPrefix, root, itemTemplate, onCloseAll, onFocusParent, ariaLabel } = props;
	const rows = visibleItems(items);
	const openIndex = useSignal(-1);
	const rowRefs = useRef<Array<HTMLElement | null>>([]);
	const anchorRefs = useRef<Array<{ current: HTMLElement | null }>>([]);
	const listRef = useRef<HTMLUListElement>(null);

	const focusable = (i: number) => !isSeparator(rows[i]) && !rows[i].disabled;
	const step = (from: number, delta: 1 | -1): number => {
		const n = rows.length;
		let i = from;
		for (let s = 0; s < n; s++) {
			i = (i + delta + n) % n;
			if (focusable(i)) return i;
		}
		return from;
	};
	const focusRow = (i: number) => rowRefs.current[i]?.focus();

	const openSubmenu = (i: number, focusChild: boolean) => {
		if (!hasChildren(rows[i]) || rows[i].disabled) return;
		openIndex.value = i;
		if (focusChild) {
			queueMicrotask(() => {
				const first = document.getElementById(`${idPrefix}-${i}-sub`)
					?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
				first?.focus();
			});
		}
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, i: number) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				focusRow(step(i, 1));
				break;
			case "ArrowUp":
				e.preventDefault();
				focusRow(step(i, -1));
				break;
			case "Home":
				e.preventDefault();
				focusRow(step(-1, 1));
				break;
			case "End":
				e.preventDefault();
				focusRow(step(0, -1));
				break;
			case "ArrowRight":
				if (hasChildren(rows[i])) {
					e.preventDefault();
					openSubmenu(i, true);
				}
				break;
			case "ArrowLeft":
				if (!root) {
					e.preventDefault();
					onFocusParent?.();
				}
				break;
			case "Enter":
			case " ": {
				e.preventDefault();
				const item = rows[i];
				if (hasChildren(item)) openSubmenu(i, true);
				else if (item.url) onCloseAll();
				else if (activate(item, e as unknown as Event)) onCloseAll();
				break;
			}
			case "Escape":
				e.preventDefault();
				onCloseAll();
				break;
		}
	};

	const renderContent = (item: MenuItem): VNode =>
		itemTemplate ? itemTemplate(item) : (
			<>
				{item.icon && <span class="ui-tieredmenu__icon" aria-hidden="true">{item.icon}</span>}
				<span class="ui-tieredmenu__label">{item.label}</span>
				{item.shortcut && (
					<span class="ui-tieredmenu__shortcut" aria-hidden="true">{item.shortcut}</span>
				)}
				{item.badge != null && <span class="ui-tieredmenu__badge">{item.badge}</span>}
				{hasChildren(item) && <Icon name="caret-right" class="ui-tieredmenu__arrow" />}
			</>
		);

	return (
		<ul ref={listRef} role="menu" class="ui-tieredmenu__list" aria-label={ariaLabel}>
			{rows.map((item, i) => {
				if (isSeparator(item)) {
					return <li key={`sep-${i}`} role="separator" class="ui-tieredmenu__separator" />;
				}
				const sub = hasChildren(item);
				const isOpen = openIndex.value === i;
				if (!anchorRefs.current[i]) anchorRefs.current[i] = { current: null };
				const shared = {
					id: `${idPrefix}-${i}`,
					role: "menuitem" as const,
					tabIndex: -1,
					class: cx(
						"ui-tieredmenu__item",
						sub && "ui-tieredmenu__item--parent",
						isOpen && "ui-tieredmenu__item--open",
						item.disabled && "ui-tieredmenu__item--disabled",
						item.active && "ui-tieredmenu__item--current",
						item.class,
					),
					"aria-haspopup": sub ? ("menu" as const) : undefined,
					"aria-expanded": sub ? isOpen : undefined,
					"aria-disabled": item.disabled || undefined,
					"aria-current": item.active || undefined,
					ref: (el: HTMLElement | null) => {
						rowRefs.current[i] = el;
						anchorRefs.current[i].current = el;
					},
					onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) => onKeyDown(e, i),
					onMouseEnter: () => {
						if (sub && !item.disabled) openIndex.value = i;
						else openIndex.value = -1;
						rowRefs.current[i]?.focus();
					},
				};
				const rowChild = item.url && !item.disabled
					? (
						<a {...shared} href={item.url} target={item.target} onClick={() => onCloseAll()}>
							{renderContent(item)}
						</a>
					)
					: (
						<div
							{...shared}
							onClick={(e: Event) => {
								if (item.disabled) return;
								if (sub) openSubmenu(i, false);
								else if (activate(item, e)) onCloseAll();
							}}
						>
							{renderContent(item)}
						</div>
					);
				return (
					<li key={itemKey(item, i)} role="none" class="ui-tieredmenu__row">
						{rowChild}
						{sub && isOpen && (
							<TieredFlyout
								id={`${idPrefix}-${i}-sub`}
								anchorRef={anchorRefs.current[i]}
								items={item.items!}
								itemTemplate={itemTemplate}
								onCloseAll={onCloseAll}
								onFocusParent={() => {
									openIndex.value = -1;
									rowRefs.current[i]?.focus();
								}}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** A positioned child level anchored to its parent row via `useFloating` (`right-start`, flips). */
function TieredFlyout(props: {
	id: string;
	anchorRef: { current: HTMLElement | null };
	items: MenuItem[];
	itemTemplate?: (item: MenuItem) => VNode;
	onCloseAll: () => void;
	onFocusParent: () => void;
}): VNode {
	const panelRef = useRef<HTMLDivElement>(null);
	const floating = useFloating({
		open: true,
		triggerRef: props.anchorRef as { current: HTMLElement },
		panelRef,
		placement: "right-start" as Placement,
		offset: 2,
	});
	return (
		<div
			id={props.id}
			ref={panelRef}
			class="ui-tieredmenu__panel ui-tieredmenu__panel--sub"
			style={floating
				? styleVars({ "--float-top": `${floating.top}px`, "--float-left": `${floating.left}px` })
				: undefined}
		>
			<TieredLevel
				items={props.items}
				idPrefix={props.id}
				root={false}
				itemTemplate={props.itemTemplate}
				onCloseAll={props.onCloseAll}
				onFocusParent={props.onFocusParent}
			/>
		</div>
	);
}

/**
 * TieredMenu — nested cascading menus whose submenus fly out to the side on hover or keyboard, to
 * arbitrary depth. Static inline or `popup` (anchored, dismiss on outside-pointer/Escape). Full
 * WAI-ARIA menu semantics with `aria-haspopup`/`aria-expanded`; Right/Left open/close a submenu,
 * Up/Down/Home/End move within a level, Enter/Space activate. Reduced-motion safe.
 */
export function TieredMenu(props: TieredMenuProps): JSX.Element {
	const { model, popup = false, trigger, triggerLabel = "Menu", itemTemplate, class: className } =
		props;
	const rootId = useId(undefined, "tiered");
	const open = useSignal(!popup);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const floating = useFloating({ open: popup && open.value, triggerRef, panelRef });
	useDismiss({ open: popup && open.value, onDismiss: () => close(), panelRef, triggerRef });

	const close = () => {
		if (!popup) return;
		open.value = false;
		triggerRef.current?.focus();
	};
	const openPanel = () => {
		open.value = true;
		queueMicrotask(() =>
			panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
				?.focus()
		);
	};

	const level = (
		<TieredLevel
			items={model}
			idPrefix={rootId}
			root
			itemTemplate={itemTemplate}
			onCloseAll={() => close()}
			ariaLabel={popup ? triggerLabel : undefined}
		/>
	);

	if (!popup) {
		return <nav class={cx("ui-tieredmenu", className)}>{level}</nav>;
	}

	return (
		<span class={cx("ui-tieredmenu", "ui-tieredmenu--popup", className)}>
			<button
				ref={triggerRef}
				type="button"
				class="ui-tieredmenu__trigger"
				aria-haspopup="menu"
				aria-expanded={open.value}
				aria-label={triggerLabel}
				onClick={() => (open.value ? close() : openPanel())}
			>
				{trigger ?? <Icon name="menu" />}
			</button>
			{open.value && (
				<div
					ref={panelRef}
					class="ui-tieredmenu__panel"
					style={floating
						? styleVars({
							"--float-top": `${floating.top}px`,
							"--float-left": `${floating.left}px`,
						})
						: undefined}
				>
					{level}
				</div>
			)}
		</span>
	);
}
