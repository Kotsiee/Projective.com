import type { JSX, VNode } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import "../styles/tabmenu.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useListNavigation } from "../../hooks/useListNavigation.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";
import type { MenuItem } from "../../types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Props for {@link TabMenu}. */
export interface TabMenuProps {
	/** Top-bar tab destinations. Items with a `url` render as anchors (link-nav mode). */
	model: MenuItem[];
	/** Bound highlighted tab index — raw number (uncontrolled) or `Signal<number>` (controlled). */
	activeIndex: Bindable<number>;
	/** Fired when the highlighted tab changes. */
	onActiveIndexChange?: ValueChange<number>;
	/** Scrollable overflow strip with chevron buttons when the tabs exceed the available width (default `true`). */
	scrollable?: boolean;
	/** Custom renderer for a tab's inner content (icon/label/badge). */
	itemTemplate?: (item: MenuItem, index: number) => VNode;
	/** Accessible label for the tab strip (default `"Tabs"`). */
	"aria-label"?: string;
	class?: string;
}
// #endregion

function prefersReducedMotion(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * TabMenu — top-bar anchor-style tab navigation over a {@link MenuItem} `model`. When any item
 * carries a `url` it renders as a `role="menubar"` of native anchors (browser-navigated tabs, e.g.
 * a top-level app section switcher); otherwise it renders a `role="tablist"` of buttons that only
 * move `activeIndex` (in-page section switch with no owned content — pair with your own panels).
 * A sliding ink-bar underline tracks the active tab (collapses under reduced motion); on narrow
 * widths the strip becomes horizontally scrollable with chevron buttons that appear once the tabs
 * overflow. Keyboard: roving tabindex, Left/Right move (auto-activating in tablist mode), Home/End
 * jump to the ends, Enter/Space activate in tablist mode.
 */
export function TabMenu(props: TabMenuProps): JSX.Element {
	const {
		model,
		activeIndex,
		onActiveIndexChange,
		scrollable = true,
		itemTemplate,
		"aria-label": ariaLabel = "Tabs",
		class: className,
	} = props;

	const ctrl = useControllable<number>(activeIndex, 0, onActiveIndexChange);
	const rootId = useId(undefined, "tabmenu");
	const active = ctrl.signal.value;
	const linkMode = model.some((m) => !!m.url);

	const isDisabled = (i: number) => !!model[i]?.disabled;
	const nav = useListNavigation(() => model.length, isDisabled);

	const scrollRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const itemRefs = useRef<Map<number, HTMLElement>>(new Map());
	const inkRef = useRef<HTMLSpanElement>(null);

	const [overflowing, setOverflowing] = useState(false);

	// #region Ink bar
	const positionInk = () => {
		const el = itemRefs.current.get(active);
		const ink = inkRef.current;
		if (!el || !ink) return;
		ink.style.setProperty("--ink-left", `${el.offsetLeft}px`);
		ink.style.setProperty("--ink-width", `${el.offsetWidth}px`);
	};

	useEffect(() => {
		positionInk();
		nav.reset(active);
	}, [active, model.length]);

	useEffect(() => {
		const onResize = () => positionInk();
		globalThis.addEventListener("resize", onResize);
		return () => globalThis.removeEventListener("resize", onResize);
	}, [active]);
	// #endregion

	// #region Overflow detection
	useEffect(() => {
		const check = () => {
			const el = scrollRef.current;
			setOverflowing(!!el && el.scrollWidth > el.clientWidth + 1);
		};
		check();
		globalThis.addEventListener("resize", check);
		return () => globalThis.removeEventListener("resize", check);
	}, [model.length]);

	const scrollByPx = (dx: number) => {
		scrollRef.current?.scrollBy({ left: dx, behavior: prefersReducedMotion() ? "auto" : "smooth" });
	};
	// #endregion

	// #region Activation + keyboard
	const focusItem = (i: number) => itemRefs.current.get(i)?.focus();

	const goTo = (i: number) => {
		if (isDisabled(i)) return;
		ctrl.set(i);
	};

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>, i: number) => {
		let moved = true;
		if (e.key === "ArrowRight") nav.move(1);
		else if (e.key === "ArrowLeft") nav.move(-1);
		else if (e.key === "Home") nav.toEdge("first");
		else if (e.key === "End") nav.toEdge("last");
		else moved = false;

		if (moved) {
			e.preventDefault();
			const next = nav.active.peek();
			focusItem(next);
			if (!linkMode) goTo(next);
			return;
		}
		if ((e.key === "Enter" || e.key === " ") && !linkMode) {
			e.preventDefault();
			goTo(i);
		}
	};
	// #endregion

	return (
		<div class={cx("ui-tabmenu", scrollable && "ui-tabmenu--scrollable", className)}>
			{scrollable && overflowing && (
				<button
					type="button"
					class="ui-tabmenu__chevron ui-tabmenu__chevron--prev"
					aria-label="Scroll tabs backward"
					onClick={() => scrollByPx(-160)}
				>
					<Icon name="chevron-left" />
				</button>
			)}
			<div ref={scrollRef} class="ui-tabmenu__scroll">
				<ul
					ref={listRef}
					id={rootId}
					class="ui-tabmenu__list"
					role={linkMode ? "menubar" : "tablist"}
					aria-label={ariaLabel}
				>
					{model.map((item, i) => {
						const disabled = isDisabled(i);
						const isActive = i === active;
						const content = itemTemplate ? itemTemplate(item, i) : (
							<>
								{item.icon && <span class="ui-tabmenu__icon" aria-hidden="true">{item.icon}</span>}
								<span class="ui-tabmenu__label">{item.label}</span>
								{item.badge != null && <span class="ui-tabmenu__badge">{item.badge}</span>}
							</>
						);

						const shared = {
							id: `${rootId}-tab-${i}`,
							class: cx(
								"ui-tabmenu__tab",
								isActive && "ui-tabmenu__tab--active",
								disabled && "ui-tabmenu__tab--disabled",
							),
							tabIndex: i === nav.active.value ? 0 : -1,
							"aria-disabled": disabled || undefined,
							onFocus: () => nav.reset(i),
							onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) => onKeyDown(e, i),
							ref: (el: HTMLElement | null) => {
								if (el) itemRefs.current.set(i, el);
								else itemRefs.current.delete(i);
							},
						};

						return (
							<li key={item.key ?? item.label ?? i} class="ui-tabmenu__item" role="none">
								{linkMode
									? (
										<a
											{...shared}
											role="menuitem"
											href={disabled ? undefined : item.url}
											target={item.target}
											aria-current={isActive ? "page" : undefined}
											onClick={() => !disabled && goTo(i)}
										>
											{content}
										</a>
									)
									: (
										<button
											{...shared}
											type="button"
											role="tab"
											aria-selected={isActive}
											disabled={disabled}
											onClick={() => goTo(i)}
										>
											{content}
										</button>
									)}
							</li>
						);
					})}
					<span ref={inkRef} class="ui-tabmenu__ink" aria-hidden="true" />
				</ul>
			</div>
			{scrollable && overflowing && (
				<button
					type="button"
					class="ui-tabmenu__chevron ui-tabmenu__chevron--next"
					aria-label="Scroll tabs forward"
					onClick={() => scrollByPx(160)}
				>
					<Icon name="chevron-right" />
				</button>
			)}
		</div>
	);
}
