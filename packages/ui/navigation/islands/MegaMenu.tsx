import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/megamenu.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import type { Placement } from "../../types/mod.ts";
import type { MenuItem } from "../../types/mod.ts";
import { Icon } from "../../icons/mod.ts";
import { activate, hasChildren, isSeparator, itemKey, visibleItems } from "../core/menu.ts";

// #region Props
/** Props for {@link MegaMenu}. */
export interface MegaMenuProps {
	/**
	 * Top items. Each top item's `items` are treated as columns; every column is itself a
	 * {@link MenuItem} whose `label` is the column header and whose `items` are the column's links.
	 */
	model: MenuItem[];
	/** Bar orientation — `horizontal` (default) drops panels downward, `vertical` flies them right. */
	orientation?: "horizontal" | "vertical";
	/** Leading slot. */
	start?: VNode;
	/** Trailing slot. */
	end?: VNode;
	/** Custom renderer for a column's inner content (overrides the default header + link list). */
	itemTemplate?: (column: MenuItem) => VNode;
	/** Accessible label for the bar (default `"Mega menu"`). */
	"aria-label"?: string;
	class?: string;
}
// #endregion

/**
 * MegaMenu — a horizontal or vertical bar whose submenus open as multi-column panels. Each top
 * item's `items` are columns (header + links); pass `itemTemplate` to render arbitrary column
 * content. WAI-ARIA `menubar`/`menu`: on the bar the primary axis (Left/Right when horizontal,
 * Up/Down when vertical) moves between top items and the cross axis opens the panel; inside the
 * panel Up/Down move within a column, Left/Right hop columns, Enter/Space activate, Escape closes.
 * Reduced-motion safe; the panel is fixed-positioned by `useFloating`.
 */
export function MegaMenu(props: MegaMenuProps): JSX.Element {
	const {
		model,
		orientation = "horizontal",
		start,
		end,
		itemTemplate,
		class: className,
		"aria-label": ariaLabel = "Mega menu",
	} = props;
	const horizontal = orientation === "horizontal";
	const openTop = useSignal(-1);

	const barRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const topRefs = useRef<Array<HTMLElement | null>>([]);
	const topAnchors = useRef<Array<{ current: HTMLElement | null }>>([]);
	/** grid[col][row] leaf refs for the currently open panel. */
	const grid = useRef<HTMLElement[][]>([]);

	const tops = visibleItems(model);

	const floating = useFloating({
		open: openTop.value >= 0,
		triggerRef: (topAnchors.current[openTop.value] ?? { current: null }) as {
			current: HTMLElement;
		},
		panelRef,
		placement: (horizontal ? "bottom-start" : "right-start") as Placement,
	});
	// Claimed while a column panel is open, so the bar surrenders Escape to anything opened from inside
	// the panel and the panel itself steps above an already-open surface instead of sitting at the base.
	const stack = useOverlayStack({ active: openTop.value >= 0, layer: "popover" });
	useDismiss({
		open: openTop.value >= 0,
		enabled: stack.isTop,
		onDismiss: () => (openTop.value = -1),
		panelRef,
		triggerRef: barRef,
	});

	// #region Bar keyboard
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
	const openPanel = (i: number) => {
		if (!hasChildren(tops[i])) return;
		grid.current = [];
		openTop.value = i;
		queueMicrotask(() => grid.current[0]?.[0]?.focus());
	};
	const onTopKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, i: number) => {
		const fwd = horizontal ? "ArrowRight" : "ArrowDown";
		const back = horizontal ? "ArrowLeft" : "ArrowUp";
		const openKey = horizontal ? "ArrowDown" : "ArrowRight";
		if (e.key === fwd) {
			e.preventDefault();
			topRefs.current[stepTop(i, 1)]?.focus();
		} else if (e.key === back) {
			e.preventDefault();
			topRefs.current[stepTop(i, -1)]?.focus();
		} else if (e.key === openKey || e.key === "Enter" || e.key === " ") {
			if (hasChildren(tops[i])) {
				e.preventDefault();
				openPanel(i);
			} else if (e.key !== openKey) activate(tops[i], e as unknown as Event);
		} else if (e.key === "Escape") {
			e.preventDefault();
			openTop.value = -1;
		} else if (e.key === "Home") {
			e.preventDefault();
			topRefs.current[stepTop(-1, 1)]?.focus();
		} else if (e.key === "End") {
			e.preventDefault();
			topRefs.current[stepTop(0, -1)]?.focus();
		}
	};
	// #endregion

	// #region Panel keyboard (column grid)
	const closeToTop = () => {
		const i = openTop.peek();
		openTop.value = -1;
		topRefs.current[i]?.focus();
	};
	const onPanelKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, col: number, row: number) => {
		const cols = grid.current;
		switch (e.key) {
			case "ArrowDown": {
				e.preventDefault();
				const c = cols[col];
				c[(row + 1) % c.length]?.focus();
				break;
			}
			case "ArrowUp": {
				e.preventDefault();
				const c = cols[col];
				c[(row - 1 + c.length) % c.length]?.focus();
				break;
			}
			case "ArrowRight": {
				e.preventDefault();
				const nc = cols[(col + 1) % cols.length];
				(nc[row] ?? nc[nc.length - 1])?.focus();
				break;
			}
			case "ArrowLeft": {
				e.preventDefault();
				const pc = cols[(col - 1 + cols.length) % cols.length];
				(pc[row] ?? pc[pc.length - 1])?.focus();
				break;
			}
			case "Escape":
				e.preventDefault();
				closeToTop();
				break;
			case "Tab":
				openTop.value = -1;
				break;
		}
	};
	// #endregion

	const topContent = (item: MenuItem): VNode => (
		<>
			{item.icon && <span class="ui-megamenu__icon" aria-hidden="true">{item.icon}</span>}
			<span class="ui-megamenu__label">{item.label}</span>
			{item.badge != null && <span class="ui-megamenu__badge">{item.badge}</span>}
			{hasChildren(item) && (
				<Icon class="ui-megamenu__arrow" name={horizontal ? "chevron-down" : "caret-right"} />
			)}
		</>
	);

	// #region Panel columns
	const renderColumns = (columns: MenuItem[]): VNode => {
		grid.current = [];
		return (
			<div class="ui-megamenu__columns" role="menu">
				{visibleItems(columns).map((column, ci) => {
					grid.current[ci] = [];
					if (itemTemplate) {
						return (
							<div key={itemKey(column, ci)} class="ui-megamenu__column" role="none">
								{itemTemplate(column)}
							</div>
						);
					}
					return (
						<div key={itemKey(column, ci)} class="ui-megamenu__column" role="none">
							{column.label && (
								<div class="ui-megamenu__column-header" role="presentation">{column.label}</div>
							)}
							<ul class="ui-megamenu__column-list" role="none">
								{visibleItems(column.items).map((leaf, ri) => {
									if (isSeparator(leaf)) {
										return <li key={`s${ri}`} role="separator" class="ui-megamenu__separator" />;
									}
									const ref = (el: HTMLElement | null) => {
										if (el) grid.current[ci][ri] = el;
									};
									const shared = {
										role: "menuitem" as const,
										tabIndex: -1,
										ref,
										class: cx(
											"ui-megamenu__leaf",
											leaf.disabled && "ui-megamenu__leaf--disabled",
											leaf.active && "ui-megamenu__leaf--current",
											leaf.class,
										),
										"aria-disabled": leaf.disabled || undefined,
										"aria-current": leaf.active || undefined,
										onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) =>
											onPanelKeyDown(e, ci, ri),
									};
									const content = (
										<>
											{leaf.icon && (
												<span class="ui-megamenu__leaf-icon" aria-hidden="true">{leaf.icon}</span>
											)}
											<span class="ui-megamenu__leaf-label">{leaf.label}</span>
											{leaf.badge != null && <span class="ui-megamenu__badge">{leaf.badge}</span>}
										</>
									);
									return (
										<li key={itemKey(leaf, ri)} role="none">
											{leaf.url && !leaf.disabled
												? (
													<a
														{...shared}
														href={leaf.url}
														target={leaf.target}
														onClick={() => (openTop.value = -1)}
													>
														{content}
													</a>
												)
												: (
													<div
														{...shared}
														onClick={(e: Event) => {
															if (leaf.disabled) return;
															if (activate(leaf, e)) openTop.value = -1;
														}}
													>
														{content}
													</div>
												)}
										</li>
									);
								})}
							</ul>
						</div>
					);
				})}
			</div>
		);
	};
	// #endregion

	return (
		<div
			class={cx(
				"ui-megamenu",
				horizontal ? "ui-megamenu--horizontal" : "ui-megamenu--vertical",
				className,
			)}
		>
			{start && <div class="ui-megamenu__start">{start}</div>}
			<div
				ref={barRef}
				role="menubar"
				aria-orientation={horizontal ? "horizontal" : "vertical"}
				class="ui-megamenu__bar"
				aria-label={ariaLabel}
			>
				{tops.map((item, i) => {
					if (isSeparator(item)) {
						return <div key={`sep-${i}`} role="separator" class="ui-megamenu__bar-separator" />;
					}
					const sub = hasChildren(item);
					const isOpen = openTop.value === i;
					if (!topAnchors.current[i]) topAnchors.current[i] = { current: null };
					const shared = {
						role: "menuitem" as const,
						tabIndex: i === stepTop(-1, 1) ? 0 : -1,
						class: cx(
							"ui-megamenu__top",
							isOpen && "ui-megamenu__top--open",
							item.disabled && "ui-megamenu__top--disabled",
							item.active && "ui-megamenu__top--current",
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
							if (openTop.value >= 0 && sub && !item.disabled) openPanel(i);
						},
					};
					return (
						<div key={itemKey(item, i)} class="ui-megamenu__top-wrap">
							{item.url && !sub && !item.disabled
								? <a {...shared} href={item.url} target={item.target}>{topContent(item)}</a>
								: (
									<div
										{...shared}
										onClick={(e: Event) => {
											if (item.disabled) return;
											if (sub) isOpen ? (openTop.value = -1) : openPanel(i);
											else activate(item, e);
										}}
									>
										{topContent(item)}
									</div>
								)}
						</div>
					);
				})}
			</div>
			{end && <div class="ui-megamenu__end">{end}</div>}

			{openTop.value >= 0 && hasChildren(tops[openTop.value]) && (
				<div
					ref={panelRef}
					class="ui-megamenu__panel"
					style={styleVars({
						"--float-top": floating ? `${floating.top}px` : undefined,
						"--float-left": floating ? `${floating.left}px` : undefined,
						"--z-portal": String(stack.zIndex),
					})}
				>
					{renderColumns(tops[openTop.value].items!)}
				</div>
			)}
		</div>
	);
}
