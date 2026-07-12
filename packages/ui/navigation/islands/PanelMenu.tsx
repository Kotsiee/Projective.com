import type { JSX, VNode } from "preact";
import { useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import "../styles/panelmenu.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import type { MenuItem } from "../../types/mod.ts";
import { activate, hasChildren, isSeparator, itemKey, visibleItems } from "../core/menu.ts";

// #region Props
/** Props for {@link PanelMenu}. */
export interface PanelMenuProps {
	/** Root items; any item with `items` becomes a collapsible section (recursively). */
	model: MenuItem[];
	/** Allow several top sections open at once (default `false` — accordion, one at a time). */
	multiple?: boolean;
	/** Keys of sections initially expanded (matches `MenuItem.key` / `label`). */
	defaultExpanded?: string[];
	/** Custom item content renderer. */
	itemTemplate?: (item: MenuItem) => VNode;
	/** Accessible label for the tree. */
	"aria-label"?: string;
	class?: string;
}

interface SectionProps {
	items: MenuItem[];
	level: number;
	multiple: boolean;
	expanded: Signal<Record<string, boolean>>;
	idPrefix: string;
	itemTemplate?: (item: MenuItem) => VNode;
	onRowKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) => void;
}
// #endregion

// #region Recursive section
/** A single accordion level. Headers toggle their subtree; leaves activate. Recurses for depth. */
function PanelSection(props: SectionProps): VNode {
	const { items, level, multiple, expanded, idPrefix, itemTemplate, onRowKeyDown } = props;
	const rows = visibleItems(items);

	const toggle = (key: string) => {
		const cur = expanded.value;
		if (!multiple && level === 0) {
			expanded.value = { [key]: !cur[key] };
		} else {
			expanded.value = { ...cur, [key]: !cur[key] };
		}
	};

	const content = (item: MenuItem): VNode =>
		itemTemplate ? itemTemplate(item) : (
			<>
				{item.icon && <span class="ui-panelmenu__icon" aria-hidden="true">{item.icon}</span>}
				<span class="ui-panelmenu__label">{item.label}</span>
				{item.badge != null && <span class="ui-panelmenu__badge">{item.badge}</span>}
			</>
		);

	return (
		<ul class="ui-panelmenu__list" role={level === 0 ? "tree" : "group"}>
			{rows.map((item, i) => {
				if (isSeparator(item)) {
					return <li key={`sep-${i}`} role="separator" class="ui-panelmenu__separator" />;
				}
				const key = itemKey(item, i);
				const sub = hasChildren(item);
				const isOpen = !!expanded.value[key];
				const panelId = `${idPrefix}-${i}-panel`;
				return (
					<li
						key={key}
						role="treeitem"
						aria-expanded={sub ? isOpen : undefined}
						aria-current={item.active || undefined}
						class="ui-panelmenu__item"
					>
						{sub
							? (
								<button
									type="button"
									data-panelmenu-row
									class={cx(
										"ui-panelmenu__header",
										isOpen && "ui-panelmenu__header--open",
										item.disabled && "ui-panelmenu__header--disabled",
										item.class,
									)}
									style={styleVars({ "--level": level })}
									aria-expanded={isOpen}
									aria-controls={panelId}
									aria-disabled={item.disabled || undefined}
									disabled={item.disabled}
									onKeyDown={onRowKeyDown}
									onClick={() => !item.disabled && toggle(key)}
								>
									<span class="ui-panelmenu__toggle" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
									{content(item)}
								</button>
							)
							: item.url && !item.disabled
							? (
								<a
									data-panelmenu-row
									class={cx("ui-panelmenu__leaf", item.active && "ui-panelmenu__leaf--current", item.class)}
									style={styleVars({ "--level": level })}
									href={item.url}
									target={item.target}
									aria-current={item.active || undefined}
									onKeyDown={onRowKeyDown}
								>
									{content(item)}
								</a>
							)
							: (
								<button
									type="button"
									data-panelmenu-row
									class={cx(
										"ui-panelmenu__leaf",
										item.active && "ui-panelmenu__leaf--current",
										item.disabled && "ui-panelmenu__leaf--disabled",
										item.class,
									)}
									style={styleVars({ "--level": level })}
									aria-disabled={item.disabled || undefined}
									disabled={item.disabled}
									onKeyDown={onRowKeyDown}
									onClick={(e) => !item.disabled && activate(item, e)}
								>
									{content(item)}
								</button>
							)}
						{sub && (
							<div
								id={panelId}
								class={cx("ui-panelmenu__content", isOpen && "ui-panelmenu__content--open")}
								role="none"
							>
								<div class="ui-panelmenu__content-inner">
									<PanelSection
										items={item.items!}
										level={level + 1}
										multiple={multiple}
										expanded={expanded}
										idPrefix={`${idPrefix}-${i}`}
										itemTemplate={itemTemplate}
										onRowKeyDown={onRowKeyDown}
									/>
								</div>
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}
// #endregion

/**
 * PanelMenu — an accordion-style vertical sidebar. Top items with `items` expand/collapse to reveal
 * nested items (recursively). Signal-driven expansion with a smooth token-duration height transition
 * (grid-rows), collapsing instantly under reduced-motion. `multiple` allows several top sections open
 * at once; otherwise it behaves as a single-open accordion. WAI-ARIA `tree`/`treeitem` with
 * `aria-expanded`; Up/Down move between visible rows, Right/Left expand/collapse, Enter/Space
 * toggle or activate, Home/End jump.
 */
export function PanelMenu(props: PanelMenuProps): JSX.Element {
	const {
		model,
		multiple = false,
		defaultExpanded = [],
		itemTemplate,
		class: className,
		"aria-label": ariaLabel,
	} = props;
	const rootId = useId(undefined, "panelmenu");
	const rootRef = useRef<HTMLDivElement>(null);
	const expanded = useSignal<Record<string, boolean>>(
		Object.fromEntries(defaultExpanded.map((k) => [k, true])),
	);

	// #region Tree keyboard (query visible rows)
	const rowList = (): HTMLElement[] =>
		Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-panelmenu-row]") ?? [])
			.filter((el) =>
				el.getAttribute("aria-disabled") !== "true" &&
				el.closest(".ui-panelmenu__content:not(.ui-panelmenu__content--open)") === null
			);

	const onRowKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLElement>) => {
		const rows = rowList();
		const current = e.currentTarget as HTMLElement;
		const idx = rows.indexOf(current);
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
				if (current.getAttribute("aria-expanded") === "false") {
					e.preventDefault();
					current.click();
				}
				break;
			case "ArrowLeft":
				if (current.getAttribute("aria-expanded") === "true") {
					e.preventDefault();
					current.click();
				}
				break;
		}
	};
	// #endregion

	return (
		<nav
			ref={rootRef}
			id={rootId}
			class={cx("ui-panelmenu", className)}
			aria-label={ariaLabel}
		>
			<PanelSection
				items={model}
				level={0}
				multiple={multiple}
				expanded={expanded}
				idPrefix={rootId}
				itemTemplate={itemTemplate}
				onRowKeyDown={onRowKeyDown}
			/>
		</nav>
	);
}
