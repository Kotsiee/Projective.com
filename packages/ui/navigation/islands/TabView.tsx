import type { ComponentChildren, JSX, VNode } from "preact";
import { toChildArray } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/tabview.css";
import { cx } from "../../core/cx.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useListNavigation } from "../../hooks/useListNavigation.ts";
import { useId } from "../../hooks/useId.ts";
import type { Bindable, ValueChange } from "../../fields/types/mod.ts";

// #region TabPanel
/** Props for {@link TabPanel} — a declarative config slot consumed by {@link TabView}. */
export interface TabPanelProps {
	/** Tab label — a string or a custom `VNode` (icon + text, badge, etc). */
	header: string | VNode;
	/** Disable this tab: unfocusable, unselectable, dimmed. */
	disabled?: boolean;
	/** Render a `×` on the tab that fires `TabView`'s `onTabClose`. */
	closable?: boolean;
	/** Keep the panel mounted (hidden, not unmounted) once visited (default `true`). Set `false` to
	 * fully unmount it whenever it is not the active tab (re-render from scratch on every activation). */
	cache?: boolean;
	children?: ComponentChildren;
}

/**
 * TabPanel — a declarative config slot. `TabView` reads this component's props straight off its
 * child `VNode`s (it is never invoked as a function by `TabView`); rendering here only covers the
 * degenerate case of a `TabPanel` mounted outside a `TabView`.
 */
export function TabPanel(props: TabPanelProps): VNode | null {
	return (props.children as VNode) ?? null;
}
// #endregion

// #region TabView props
/** Props for {@link TabView}. */
export interface TabViewProps {
	/** One {@link TabPanel} per tab. Falsy children (`{cond && <TabPanel .../>}`) are skipped. */
	children: ComponentChildren;
	/** Bound active tab index — raw number (uncontrolled) or `Signal<number>` (controlled). */
	activeIndex?: Bindable<number>;
	/** Fired whenever the active tab changes. */
	onActiveIndexChange?: ValueChange<number>;
	/** Horizontally scrollable tab strip for overflow (default `false`). */
	scrollable?: boolean;
	/** Fired when a closable tab's `×` is activated — the caller owns removing it from `children`. */
	onTabClose?: (index: number) => void;
	/** Arrow-key activation model: `"auto"` selects on move (default), `"manual"` requires Enter/Space. */
	activationMode?: "auto" | "manual";
	/** Accessible label for the tablist (default `"Tabs"`). */
	"aria-label"?: string;
	class?: string;
}

interface PanelMeta {
	header: string | VNode;
	disabled: boolean;
	closable: boolean;
	cache: boolean;
	content: ComponentChildren;
}

/** Extract `TabPanel` config off the raw children — text/falsy nodes are dropped. */
function readPanels(children: ComponentChildren): PanelMeta[] {
	return toChildArray(children)
		.filter((c): c is VNode<TabPanelProps> =>
			typeof c === "object" && c !== null && (c as VNode).type === TabPanel
		)
		.map((c) => ({
			header: c.props.header,
			disabled: !!c.props.disabled,
			closable: !!c.props.closable,
			cache: c.props.cache ?? true,
			content: c.props.children,
		}));
}
// #endregion

/**
 * TabView — in-page tab switcher over {@link TabPanel} children. Full WAI-ARIA tabs pattern:
 * `tablist`/`tab`/`tabpanel` roles, `aria-selected`, `aria-controls`/`aria-labelledby`, roving
 * tabindex, and Left/Right/Home/End keyboard navigation with `"auto"` (select-on-move) or
 * `"manual"` (Enter/Space-to-select) activation. Panels default to `cache` (stay mounted once
 * visited, toggled with the `hidden` attribute so state survives switching); set a panel's
 * `cache={false}` to unmount it whenever it is not the active tab. Closable tabs render a `×` that
 * fires `onTabClose` — the caller owns actually removing the panel from `children`. The active tab
 * gets a sliding ink-bar underline that collapses under reduced motion.
 */
export function TabView(props: TabViewProps): JSX.Element {
	const {
		children,
		activeIndex,
		onActiveIndexChange,
		scrollable = false,
		onTabClose,
		activationMode = "auto",
		"aria-label": ariaLabel = "Tabs",
		class: className,
	} = props;

	const panels = readPanels(children);
	const ctrl = useControllable<number>(activeIndex, 0, onActiveIndexChange);
	const rootId = useId(undefined, "tabview");
	const active = panels.length > 0
		? Math.min(Math.max(ctrl.signal.value, 0), panels.length - 1)
		: 0;

	const visited = useRef<Set<number>>(new Set([active]));
	useEffect(() => {
		visited.current.add(active);
	}, [active]);

	const isDisabled = (i: number) => !!panels[i]?.disabled;
	const nav = useListNavigation(() => panels.length, isDisabled);

	const tabRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
	const inkRef = useRef<HTMLSpanElement>(null);

	// #region Ink bar + roving sync
	useEffect(() => {
		nav.reset(active);
		const el = tabRefs.current.get(active);
		const ink = inkRef.current;
		if (el && ink) {
			ink.style.setProperty("--ink-left", `${el.offsetLeft}px`);
			ink.style.setProperty("--ink-width", `${el.offsetWidth}px`);
		}
	}, [active, panels.length]);

	// Clamp `activeIndex` if the panel list shrinks out from under it (e.g. a closed tab).
	useEffect(() => {
		if (panels.length > 0 && ctrl.signal.value > panels.length - 1) {
			ctrl.set(panels.length - 1);
		}
	}, [panels.length]);
	// #endregion

	// #region Activation + keyboard
	const goTo = (i: number) => {
		if (isDisabled(i)) return;
		ctrl.set(i);
	};
	const focusTab = (i: number) => tabRefs.current.get(i)?.focus();

	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLButtonElement>, i: number) => {
		let moved = true;
		if (e.key === "ArrowRight") nav.move(1);
		else if (e.key === "ArrowLeft") nav.move(-1);
		else if (e.key === "Home") nav.toEdge("first");
		else if (e.key === "End") nav.toEdge("last");
		else moved = false;

		if (moved) {
			e.preventDefault();
			const next = nav.active.peek();
			focusTab(next);
			if (activationMode === "auto") goTo(next);
			return;
		}
		if ((e.key === "Enter" || e.key === " ") && activationMode === "manual") {
			e.preventDefault();
			goTo(i);
		}
	};
	// #endregion

	return (
		<div class={cx("ui-tabview", className)}>
			<div
				role="tablist"
				class={cx("ui-tabview__nav", scrollable && "ui-tabview__nav--scrollable")}
				aria-label={ariaLabel}
			>
				{panels.map((panel, i) => {
					const isActive = i === active;
					return (
						<button
							key={i}
							ref={(el: HTMLButtonElement | null) => {
								if (el) tabRefs.current.set(i, el);
								else tabRefs.current.delete(i);
							}}
							type="button"
							role="tab"
							id={`${rootId}-tab-${i}`}
							class={cx(
								"ui-tabview__tab",
								isActive && "ui-tabview__tab--active",
								panel.disabled && "ui-tabview__tab--disabled",
							)}
							aria-selected={isActive}
							aria-controls={`${rootId}-panel-${i}`}
							aria-disabled={panel.disabled || undefined}
							tabIndex={i === nav.active.value ? 0 : -1}
							disabled={panel.disabled}
							onClick={() => goTo(i)}
							onFocus={() => nav.reset(i)}
							onKeyDown={(e) => onKeyDown(e, i)}
						>
							<span class="ui-tabview__tab-label">{panel.header}</span>
							{panel.closable && (
								<span
									role="button"
									tabIndex={0}
									class="ui-tabview__tab-close"
									aria-label="Close tab"
									onClick={(e: JSX.TargetedMouseEvent<HTMLSpanElement>) => {
										e.stopPropagation();
										onTabClose?.(i);
									}}
									onKeyDown={(e: JSX.TargetedKeyboardEvent<HTMLSpanElement>) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											e.stopPropagation();
											onTabClose?.(i);
										}
									}}
								>
									×
								</span>
							)}
						</button>
					);
				})}
				<span ref={inkRef} class="ui-tabview__ink" aria-hidden="true" />
			</div>

			{panels.map((panel, i) => {
				const isActive = i === active;
				if (!isActive && !panel.cache) return null;
				if (!isActive && !visited.current.has(i)) return null;
				return (
					<div
						key={i}
						id={`${rootId}-panel-${i}`}
						role="tabpanel"
						class="ui-tabview__panel"
						aria-labelledby={`${rootId}-tab-${i}`}
						hidden={!isActive}
						tabIndex={0}
					>
						{panel.content}
					</div>
				);
			})}
		</div>
	);
}
