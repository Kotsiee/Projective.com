import type { JSX, RefObject, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/contextmenu.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import type { Placement } from "../../types/mod.ts";
import type { MenuItem } from "../../types/mod.ts";
import { activate, hasChildren, isSeparator, itemKey, visibleItems } from "../core/menu.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Props for {@link ContextMenu}. */
export interface ContextMenuProps {
	/** Items; any item's `items` becomes a submenu that flies out to the side. */
	model: MenuItem[];
	/** Bind the `contextmenu` (right-click) listener to the whole document instead of a target. */
	global?: boolean;
	/** Element to bind the right-click to (ignored when `global`). */
	targetRef?: RefObject<HTMLElement>;
	/** Custom item content renderer. */
	itemTemplate?: (item: MenuItem) => VNode;
	/** Accessible label for the menu (default `"Context menu"`). */
	"aria-label"?: string;
	class?: string;
}

interface LevelProps {
	items: MenuItem[];
	idPrefix: string;
	itemTemplate?: (item: MenuItem) => VNode;
	onCloseAll: () => void;
	onFocusParent?: () => void;
	ariaLabel?: string;
}
// #endregion

// #region Cascading level
/** One level of the context menu; children fly out to the right (`useFloating`). Mirrors TieredMenu. */
function CtxLevel(props: LevelProps): VNode {
	const { items, idPrefix, itemTemplate, onCloseAll, onFocusParent, ariaLabel } = props;
	const rows = visibleItems(items);
	const openIndex = useSignal(-1);
	const rowRefs = useRef<Array<HTMLElement | null>>([]);
	const anchors = useRef<Array<{ current: HTMLElement | null }>>([]);

	const focusable = (i: number) => !isSeparator(rows[i]) && !rows[i].disabled;
	const step = (from: number, delta: 1 | -1) => {
		const n = rows.length;
		let i = from;
		for (let s = 0; s < n; s++) {
			i = (i + delta + n) % n;
			if (focusable(i)) return i;
		}
		return from;
	};
	const openSub = (i: number, focusChild: boolean) => {
		if (!hasChildren(rows[i]) || rows[i].disabled) return;
		openIndex.value = i;
		if (focusChild) {
			queueMicrotask(() =>
				document.getElementById(`${idPrefix}-${i}-sub`)
					?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
			);
		}
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, i: number) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				rowRefs.current[step(i, 1)]?.focus();
				break;
			case "ArrowUp":
				e.preventDefault();
				rowRefs.current[step(i, -1)]?.focus();
				break;
			case "Home":
				e.preventDefault();
				rowRefs.current[step(-1, 1)]?.focus();
				break;
			case "End":
				e.preventDefault();
				rowRefs.current[step(0, -1)]?.focus();
				break;
			case "ArrowRight":
				if (hasChildren(rows[i])) {
					e.preventDefault();
					openSub(i, true);
				}
				break;
			case "ArrowLeft":
				if (onFocusParent) {
					e.preventDefault();
					onFocusParent();
				}
				break;
			case "Enter":
			case " ": {
				e.preventDefault();
				const item = rows[i];
				if (hasChildren(item)) openSub(i, true);
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

	const content = (item: MenuItem): VNode =>
		itemTemplate ? itemTemplate(item) : (
			<>
				{item.icon && <span class="ui-contextmenu__icon" aria-hidden="true">{item.icon}</span>}
				<span class="ui-contextmenu__label">{item.label}</span>
				{item.shortcut && (
					<span class="ui-contextmenu__shortcut" aria-hidden="true">{item.shortcut}</span>
				)}
				{item.badge != null && <span class="ui-contextmenu__badge">{item.badge}</span>}
				{hasChildren(item) && <Icon name="caret-right" class="ui-contextmenu__arrow" />}
			</>
		);

	return (
		<ul role="menu" class="ui-contextmenu__list" aria-label={ariaLabel}>
			{rows.map((item, i) => {
				if (isSeparator(item)) {
					return <li key={`sep-${i}`} role="separator" class="ui-contextmenu__separator" />;
				}
				const sub = hasChildren(item);
				const isOpen = openIndex.value === i;
				if (!anchors.current[i]) anchors.current[i] = { current: null };
				const shared = {
					id: `${idPrefix}-${i}`,
					role: "menuitem" as const,
					tabIndex: -1,
					class: cx(
						"ui-contextmenu__item",
						sub && "ui-contextmenu__item--parent",
						isOpen && "ui-contextmenu__item--open",
						item.disabled && "ui-contextmenu__item--disabled",
						item.active && "ui-contextmenu__item--current",
						item.class,
					),
					"aria-haspopup": sub ? ("menu" as const) : undefined,
					"aria-expanded": sub ? isOpen : undefined,
					"aria-disabled": item.disabled || undefined,
					ref: (el: HTMLElement | null) => {
						rowRefs.current[i] = el;
						anchors.current[i].current = el;
					},
					onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) => onKeyDown(e, i),
					onMouseEnter: () => {
						openIndex.value = sub && !item.disabled ? i : -1;
						rowRefs.current[i]?.focus();
					},
				};
				return (
					<li key={itemKey(item, i)} role="none" class="ui-contextmenu__row">
						{item.url && !item.disabled
							? (
								<a {...shared} href={item.url} target={item.target} onClick={() => onCloseAll()}>
									{content(item)}
								</a>
							)
							: (
								<div
									{...shared}
									onClick={(e: Event) => {
										if (item.disabled) return;
										if (sub) openSub(i, false);
										else if (activate(item, e)) onCloseAll();
									}}
								>
									{content(item)}
								</div>
							)}
						{sub && isOpen && (
							<CtxFlyout
								id={`${idPrefix}-${i}-sub`}
								anchorRef={anchors.current[i]}
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

/** A submenu level anchored to its parent row (`right-start`, flips near edges). */
function CtxFlyout(props: {
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
			class="ui-contextmenu__panel ui-contextmenu__panel--sub"
			style={floating
				? styleVars({ "--float-top": `${floating.top}px`, "--float-left": `${floating.left}px` })
				: undefined}
		>
			<CtxLevel
				items={props.items}
				idPrefix={props.id}
				itemTemplate={props.itemTemplate}
				onCloseAll={props.onCloseAll}
				onFocusParent={props.onFocusParent}
			/>
		</div>
	);
}
// #endregion

/**
 * ContextMenu — a right-click (`contextmenu`) bound menu, opening at the pointer with fixed,
 * viewport-clamped positioning. Bind it globally (`global`) or to a `targetRef`. Supports nested
 * submenus that fly out to the side, full WAI-ARIA menu semantics (`aria-haspopup`/`aria-expanded`),
 * and the complete keyboard model once open (Up/Down/Home/End, Right/Left open/close, Enter/Space
 * activate, Escape/outside-pointer close). Reduced-motion safe.
 */
export function ContextMenu(props: ContextMenuProps): JSX.Element {
	const {
		model,
		global = false,
		targetRef,
		itemTemplate,
		class: className,
		"aria-label": ariaLabel,
	} = props;
	const rootId = useId(undefined, "ctxmenu");
	const open = useSignal(false);
	const pos = useSignal<{ x: number; y: number }>({ x: 0, y: 0 });
	const panelRef = useRef<HTMLDivElement>(null);

	// #region Bind contextmenu + clamp
	useEffect(() => {
		const el: HTMLElement | Document | null = global ? document : (targetRef?.current ?? null);
		if (!el) return;
		const onCtx = (ev: Event) => {
			const e = ev as MouseEvent;
			e.preventDefault();
			pos.value = { x: e.clientX, y: e.clientY };
			open.value = true;
			queueMicrotask(() => {
				const panel = panelRef.current;
				if (!panel) return;
				const pad = 8;
				const w = panel.offsetWidth;
				const h = panel.offsetHeight;
				const x = Math.min(pos.value.x, globalThis.innerWidth - w - pad);
				const y = Math.min(pos.value.y, globalThis.innerHeight - h - pad);
				pos.value = { x: Math.max(pad, x), y: Math.max(pad, y) };
				panel.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
			});
		};
		el.addEventListener("contextmenu", onCtx);
		return () => el.removeEventListener("contextmenu", onCtx);
	}, [global, targetRef?.current]);
	// #endregion

	// A right-click menu is routinely raised OVER an open dialog or drawer, so it claims a slot both to
	// paint above that surface and to take Escape ownership from it for as long as it is open.
	const stack = useOverlayStack({ active: open.value, layer: "popover" });
	useDismiss({
		open: open.value,
		enabled: stack.isTop,
		onDismiss: () => (open.value = false),
		panelRef,
	});

	return (
		<>
			{open.value && (
				<div
					id={rootId}
					ref={panelRef}
					class={cx("ui-contextmenu__panel", className)}
					style={styleVars({
						"--float-top": `${pos.value.y}px`,
						"--float-left": `${pos.value.x}px`,
						"--z-portal": String(stack.zIndex),
					})}
				>
					<CtxLevel
						items={model}
						idPrefix={rootId}
						itemTemplate={itemTemplate}
						onCloseAll={() => (open.value = false)}
						ariaLabel={ariaLabel ?? "Context menu"}
					/>
				</div>
			)}
		</>
	);
}
