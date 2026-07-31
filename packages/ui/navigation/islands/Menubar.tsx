import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/menubar.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useIsMobile } from "../../hooks/useMediaQuery.ts";
import type { Placement } from "../../types/mod.ts";
import type { MenuItem } from "../../types/mod.ts";
import { activate, hasChildren, isSeparator, itemKey, visibleItems } from "../core/menu.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Props for {@link Menubar}. */
export interface MenubarProps {
	/** Top-level items; each with `items` opens a dropdown that cascades to nested flyouts. */
	model: MenuItem[];
	/** Leading slot (brand/logo). */
	start?: VNode;
	/** Trailing slot (actions/avatar). */
	end?: VNode;
	/** Accessible label for the bar (default `"Main"`). */
	"aria-label"?: string;
	/** Custom item content renderer. */
	itemTemplate?: (item: MenuItem) => VNode;
	class?: string;
}

interface SubProps {
	items: MenuItem[];
	idPrefix: string;
	placement: Placement;
	anchorRef: { current: HTMLElement | null };
	itemTemplate?: (item: MenuItem) => VNode;
	onCloseAll: () => void;
	onFocusParent: () => void;
}
// #endregion

// #region Cascading dropdown
/** A dropdown/flyout level of the Menubar. First level drops below a top item, deeper levels fly right. */
function MenubarSub(props: SubProps): VNode {
	const { items, idPrefix, placement, anchorRef, itemTemplate, onCloseAll, onFocusParent } = props;
	const rows = visibleItems(items);
	const panelRef = useRef<HTMLDivElement>(null);
	const rowRefs = useRef<Array<HTMLElement | null>>([]);
	const anchors = useRef<Array<{ current: HTMLElement | null }>>([]);
	const openIndex = useSignal(-1);

	const floating = useFloating({
		open: true,
		triggerRef: anchorRef as { current: HTMLElement },
		panelRef,
		placement,
		offset: placement.startsWith("right") ? 2 : 4,
	});

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
			case "ArrowRight":
				if (hasChildren(rows[i])) {
					e.preventDefault();
					openSub(i, true);
				}
				break;
			case "ArrowLeft":
				e.preventDefault();
				onFocusParent();
				break;
			case "Home":
				e.preventDefault();
				rowRefs.current[step(-1, 1)]?.focus();
				break;
			case "End":
				e.preventDefault();
				rowRefs.current[step(0, -1)]?.focus();
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
				onFocusParent();
				break;
		}
	};

	const content = (item: MenuItem): VNode =>
		itemTemplate ? itemTemplate(item) : (
			<>
				{item.icon && <span class="ui-menubar__icon" aria-hidden="true">{item.icon}</span>}
				<span class="ui-menubar__label">{item.label}</span>
				{item.shortcut && (
					<span class="ui-menubar__shortcut" aria-hidden="true">{item.shortcut}</span>
				)}
				{item.badge != null && <span class="ui-menubar__badge">{item.badge}</span>}
				{hasChildren(item) && <Icon name="caret-right" class="ui-menubar__arrow" />}
			</>
		);

	return (
		<div
			ref={panelRef}
			class="ui-menubar__panel"
			style={floating
				? styleVars({ "--float-top": `${floating.top}px`, "--float-left": `${floating.left}px` })
				: undefined}
		>
			<ul role="menu" class="ui-menubar__submenu">
				{rows.map((item, i) => {
					if (isSeparator(item)) {
						return <li key={`sep-${i}`} role="separator" class="ui-menubar__separator" />;
					}
					const sub = hasChildren(item);
					const isOpen = openIndex.value === i;
					if (!anchors.current[i]) anchors.current[i] = { current: null };
					const shared = {
						id: `${idPrefix}-${i}`,
						role: "menuitem" as const,
						tabIndex: -1,
						class: cx(
							"ui-menubar__menuitem",
							sub && "ui-menubar__menuitem--parent",
							isOpen && "ui-menubar__menuitem--open",
							item.disabled && "ui-menubar__menuitem--disabled",
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
						<li key={itemKey(item, i)} role="none" class="ui-menubar__subrow">
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
								<MenubarSub
									items={item.items!}
									idPrefix={`${idPrefix}-${i}-sub`}
									placement="right-start"
									anchorRef={anchors.current[i]}
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
		</div>
	);
}
// #endregion

/**
 * Menubar — a horizontal application menu bar whose top items open cascading dropdown submenus.
 * WAI-ARIA `menubar`: Left/Right move across top items, Down/Enter/Space open a dropdown and focus
 * its first row, arrows navigate within, Right/Left open/close nested flyouts, Escape returns to the
 * bar. Under `--bp-md` it collapses to a hamburger toggle revealing the same model as a stacked,
 * expandable panel. Optional `start`/`end` slots frame the bar. Reduced-motion safe.
 */
export function Menubar(props: MenubarProps): JSX.Element {
	const { model, start, end, itemTemplate, class: className, "aria-label": ariaLabel = "Main" } =
		props;
	const rootId = useId(undefined, "menubar");
	const isMobile = useIsMobile();
	const openTop = useSignal(-1);
	const mobileOpen = useSignal(false);
	const expanded = useSignal<Record<string, boolean>>({});

	const barRef = useRef<HTMLDivElement>(null);
	const topRefs = useRef<Array<HTMLElement | null>>([]);
	const topAnchors = useRef<Array<{ current: HTMLElement | null }>>([]);
	const mobileRef = useRef<HTMLDivElement>(null);
	const hamburgerRef = useRef<HTMLButtonElement>(null);

	const tops = visibleItems(model);

	useDismiss({ open: openTop.value >= 0, onDismiss: () => (openTop.value = -1), panelRef: barRef });
	useDismiss({
		open: mobileOpen.value,
		onDismiss: () => (mobileOpen.value = false),
		panelRef: mobileRef,
		triggerRef: hamburgerRef,
	});

	// #region Desktop bar keyboard
	const focusableTop = (i: number) => !isSeparator(tops[i]) && !tops[i].disabled;
	const stepTop = (from: number, delta: 1 | -1) => {
		const n = tops.length;
		let i = from;
		for (let s = 0; s < n; s++) {
			i = (i + delta + n) % n;
			if (focusableTop(i)) return i;
		}
		return from;
	};
	const openTopMenu = (i: number) => {
		if (!hasChildren(tops[i])) return;
		openTop.value = i;
		queueMicrotask(() =>
			document.getElementById(`${rootId}-drop-${i}`)
				?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
		);
	};
	const onTopKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, i: number) => {
		switch (e.key) {
			case "ArrowRight":
				e.preventDefault();
				topRefs.current[stepTop(i, 1)]?.focus();
				break;
			case "ArrowLeft":
				e.preventDefault();
				topRefs.current[stepTop(i, -1)]?.focus();
				break;
			case "ArrowDown":
			case "Enter":
			case " ":
				if (hasChildren(tops[i])) {
					e.preventDefault();
					openTopMenu(i);
				} else if (e.key !== "ArrowDown") {
					activate(tops[i], e as unknown as Event);
				}
				break;
			case "Escape":
				e.preventDefault();
				openTop.value = -1;
				break;
			case "Home":
				e.preventDefault();
				topRefs.current[stepTop(-1, 1)]?.focus();
				break;
			case "End":
				e.preventDefault();
				topRefs.current[stepTop(0, -1)]?.focus();
				break;
		}
	};
	// #endregion

	const topContent = (item: MenuItem): VNode =>
		itemTemplate ? itemTemplate(item) : (
			<>
				{item.icon && <span class="ui-menubar__icon" aria-hidden="true">{item.icon}</span>}
				<span class="ui-menubar__label">{item.label}</span>
				{item.badge != null && <span class="ui-menubar__badge">{item.badge}</span>}
			</>
		);

	// #region Mobile panel
	const toggleExpand = (
		key: string,
	) => (expanded.value = { ...expanded.value, [key]: !expanded.value[key] });

	const mobilePanel = (
		<div ref={mobileRef} class="ui-menubar__mobile" role="menu" aria-label={ariaLabel}>
			{tops.map((item, i) => {
				const key = itemKey(item, i);
				const sub = hasChildren(item);
				const isExp = !!expanded.value[key];
				return (
					<div key={key} class="ui-menubar__mobile-group">
						{item.url && !sub
							? (
								<a
									class="ui-menubar__mobile-item"
									role="menuitem"
									href={item.url}
									target={item.target}
								>
									{topContent(item)}
								</a>
							)
							: (
								<button
									type="button"
									class="ui-menubar__mobile-item"
									role="menuitem"
									aria-haspopup={sub ? "true" : undefined}
									aria-expanded={sub ? isExp : undefined}
									onClick={(e) => {
										if (sub) toggleExpand(key);
										else activate(item, e);
									}}
								>
									{topContent(item)}
									{sub && (
										<Icon class="ui-menubar__arrow" name={isExp ? "chevron-down" : "caret-right"} />
									)}
								</button>
							)}
						{sub && isExp && (
							<div class="ui-menubar__mobile-children" role="menu">
								{visibleItems(item.items).map((child, ci) =>
									isSeparator(child)
										? <div key={`s${ci}`} role="separator" class="ui-menubar__separator" />
										: (
											<a
												key={itemKey(child, ci)}
												class="ui-menubar__mobile-item ui-menubar__mobile-item--child"
												role="menuitem"
												href={child.url ?? undefined}
												target={child.target}
												aria-disabled={child.disabled || undefined}
												onClick={(e) => !child.url && activate(child, e)}
											>
												{topContent(child)}
											</a>
										)
								)}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
	// #endregion

	return (
		<div class={cx("ui-menubar", isMobile && "ui-menubar--mobile", className)}>
			{start && <div class="ui-menubar__start">{start}</div>}

			{isMobile
				? (
					<>
						<button
							ref={hamburgerRef}
							type="button"
							class="ui-menubar__hamburger"
							aria-haspopup="menu"
							aria-expanded={mobileOpen.value}
							aria-label={ariaLabel}
							onClick={() => (mobileOpen.value = !mobileOpen.value)}
						>
							<Icon name="menu" />
						</button>
						{mobileOpen.value && mobilePanel}
					</>
				)
				: (
					<div ref={barRef} role="menubar" class="ui-menubar__bar" aria-label={ariaLabel}>
						{tops.map((item, i) => {
							if (isSeparator(item)) {
								return <div key={`sep-${i}`} role="separator" class="ui-menubar__bar-separator" />;
							}
							const sub = hasChildren(item);
							const isOpen = openTop.value === i;
							if (!topAnchors.current[i]) topAnchors.current[i] = { current: null };
							const shared = {
								role: "menuitem" as const,
								tabIndex: i === stepTop(-1, 1) ? 0 : -1,
								class: cx(
									"ui-menubar__top",
									isOpen && "ui-menubar__top--open",
									item.disabled && "ui-menubar__top--disabled",
									item.active && "ui-menubar__top--current",
									item.class,
								),
								"aria-haspopup": sub ? ("menu" as const) : undefined,
								"aria-expanded": sub ? isOpen : undefined,
								"aria-disabled": item.disabled || undefined,
								ref: (el: HTMLElement | null) => {
									topRefs.current[i] = el;
									topAnchors.current[i].current = el;
								},
								onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) => onTopKeyDown(e, i),
								onMouseEnter: () => {
									if (openTop.value >= 0 && sub && !item.disabled) openTop.value = i;
								},
							};
							return (
								<div key={itemKey(item, i)} class="ui-menubar__top-wrap">
									{item.url && !sub && !item.disabled
										? <a {...shared} href={item.url} target={item.target}>{topContent(item)}</a>
										: (
											<div
												{...shared}
												onClick={(e: Event) => {
													if (item.disabled) return;
													if (sub) openTop.value = isOpen ? -1 : i;
													else activate(item, e);
												}}
											>
												{topContent(item)}
												{sub && <Icon name="chevron-down" class="ui-menubar__arrow" />}
											</div>
										)}
									{sub && isOpen && (
										<div id={`${rootId}-drop-${i}`}>
											<MenubarSub
												items={item.items!}
												idPrefix={`${rootId}-drop-${i}`}
												placement="bottom-start"
												anchorRef={topAnchors.current[i]}
												itemTemplate={itemTemplate}
												onCloseAll={() => {
													openTop.value = -1;
													topRefs.current[i]?.focus();
												}}
												onFocusParent={() => {
													openTop.value = -1;
													topRefs.current[i]?.focus();
												}}
											/>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}

			{end && <div class="ui-menubar__end">{end}</div>}
		</div>
	);
}
