import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import "../styles/slidemenu.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import type { MenuItem } from "../../types/mod.ts";
import { activate, hasChildren, isSeparator, itemKey, visibleItems } from "../core/menu.ts";

// #region Props
/** Props for {@link SlideMenu}. */
export interface SlideMenuProps {
	/** Root items; entering an item with `items` slides the viewport left to that submenu. */
	model: MenuItem[];
	/** Label for the root level shown in the header (default `"Menu"`). */
	rootLabel?: string;
	/** Back-control label (default `"Back"`). */
	backLabel?: string;
	/** Custom item content renderer. */
	itemTemplate?: (item: MenuItem) => VNode;
	/** Accessible label for the menu. */
	"aria-label"?: string;
	class?: string;
}

interface Level {
	label: string;
	items: MenuItem[];
	/** Index of the parent row this level came from, for focus restore on back. */
	fromIndex: number;
}
// #endregion

/**
 * SlideMenu — a single-viewport, mobile-style menu. Choosing an item with `items` slides the whole
 * track left to reveal that submenu; a header back-control (and Left/Backspace/Escape) slides it
 * back, keeping a breadcrumb of the current level. Transform transitions use `--spring-standard`,
 * collapsing under reduced-motion. WAI-ARIA `menu`/`menuitem`: Up/Down move within the active level,
 * Right/Enter descend, Left/Backspace ascend, Home/End jump. Only the active level is focusable.
 */
export function SlideMenu(props: SlideMenuProps): JSX.Element {
	const {
		model,
		rootLabel = "Menu",
		backLabel = "Back",
		itemTemplate,
		class: className,
		"aria-label": ariaLabel,
	} = props;
	const rootId = useId(undefined, "slide");
	const stack = useSignal<Level[]>([{ label: rootLabel, items: model, fromIndex: -1 }]);
	const depth = useComputed(() => stack.value.length - 1);
	const levelRefs = useRef<Array<HTMLElement | null>>([]);

	const focusFirst = (levelIdx: number) =>
		queueMicrotask(() =>
			levelRefs.current[levelIdx]
				?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
		);

	// #region Navigation
	const push = (parent: MenuItem, fromIndex: number) => {
		if (!hasChildren(parent)) return;
		stack.value = [...stack.value, {
			label: parent.label ?? "",
			items: parent.items!,
			fromIndex,
		}];
		focusFirst(stack.value.length - 1);
	};
	const pop = () => {
		if (stack.value.length <= 1) return;
		const leaving = stack.value[stack.value.length - 1];
		stack.value = stack.value.slice(0, -1);
		const parentLevel = stack.value.length - 1;
		queueMicrotask(() => {
			const rows = levelRefs.current[parentLevel]
				?.querySelectorAll<HTMLElement>('[role="menuitem"]');
			rows?.[leaving.fromIndex]?.focus();
		});
	};
	// #endregion

	// #region Keyboard
	const rowsOf = (levelIdx: number): HTMLElement[] =>
		Array.from(
			levelRefs.current[levelIdx]?.querySelectorAll<HTMLElement>(
				'[role="menuitem"]:not([aria-disabled="true"])',
			) ?? [],
		);
	const onKeyDown = (
		e: JSX.TargetedKeyboardEvent<HTMLElement>,
		levelIdx: number,
		item: MenuItem,
	) => {
		const rows = rowsOf(levelIdx);
		const idx = rows.indexOf(e.currentTarget as HTMLElement);
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				rows[(idx + 1) % rows.length]?.focus();
				break;
			case "ArrowUp":
				e.preventDefault();
				rows[(idx - 1 + rows.length) % rows.length]?.focus();
				break;
			case "Home":
				e.preventDefault();
				rows[0]?.focus();
				break;
			case "End":
				e.preventDefault();
				rows[rows.length - 1]?.focus();
				break;
			case "ArrowRight":
			case "Enter":
			case " ":
				if (hasChildren(item)) {
					e.preventDefault();
					push(item, idx);
				} else if (e.key !== "ArrowRight" && !item.url) {
					activate(item, e as unknown as Event);
				}
				break;
			case "ArrowLeft":
			case "Backspace":
			case "Escape":
				if (levelIdx > 0) {
					e.preventDefault();
					pop();
				}
				break;
		}
	};
	// #endregion

	const content = (item: MenuItem): VNode =>
		itemTemplate ? itemTemplate(item) : (
			<>
				{item.icon && <span class="ui-slidemenu__icon" aria-hidden="true">{item.icon}</span>}
				<span class="ui-slidemenu__label">{item.label}</span>
				{item.badge != null && <span class="ui-slidemenu__badge">{item.badge}</span>}
				{hasChildren(item) && <span class="ui-slidemenu__arrow" aria-hidden="true">▸</span>}
			</>
		);

	const renderLevel = (level: Level, levelIdx: number): VNode => {
		const active = levelIdx === depth.value;
		return (
			<ul
				key={levelIdx}
				ref={(el) => {
					levelRefs.current[levelIdx] = el;
				}}
				role="menu"
				class="ui-slidemenu__level"
				aria-label={level.label}
				aria-hidden={active ? undefined : "true"}
			>
				{visibleItems(level.items).map((item, i) => {
					if (isSeparator(item)) {
						return <li key={`sep-${i}`} role="separator" class="ui-slidemenu__separator" />;
					}
					const sub = hasChildren(item);
					const shared = {
						role: "menuitem" as const,
						tabIndex: active ? 0 : -1,
						class: cx(
							"ui-slidemenu__item",
							sub && "ui-slidemenu__item--parent",
							item.disabled && "ui-slidemenu__item--disabled",
							item.active && "ui-slidemenu__item--current",
							item.class,
						),
						"aria-haspopup": sub ? ("menu" as const) : undefined,
						"aria-disabled": item.disabled || undefined,
						"aria-current": item.active || undefined,
						onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) => onKeyDown(e, levelIdx, item),
					};
					return (
						<li key={itemKey(item, i)} role="none">
							{item.url && !sub && !item.disabled
								? <a {...shared} href={item.url} target={item.target}>{content(item)}</a>
								: (
									<div
										{...shared}
										onClick={(e: Event) => {
											if (item.disabled) return;
											if (sub) push(item, i);
											else activate(item, e);
										}}
									>
										{content(item)}
									</div>
								)}
						</li>
					);
				})}
			</ul>
		);
	};

	const current = stack.value[depth.value];

	return (
		<nav id={rootId} class={cx("ui-slidemenu", className)} aria-label={ariaLabel ?? rootLabel}>
			<div class="ui-slidemenu__header">
				<button
					type="button"
					class="ui-slidemenu__back"
					aria-label={backLabel}
					disabled={depth.value === 0}
					onClick={pop}
				>
					<span aria-hidden="true">‹</span>
				</button>
				<span class="ui-slidemenu__title" aria-live="polite">{current.label}</span>
			</div>
			<div class="ui-slidemenu__viewport">
				<div
					class="ui-slidemenu__track"
					style={styleVars({ "--slide-depth": depth.value, "--slide-count": stack.value.length })}
				>
					{stack.value.map((level, i) => renderLevel(level, i))}
				</div>
			</div>
		</nav>
	);
}
