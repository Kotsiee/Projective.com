import type { JSX, VNode } from "preact";
import { cx } from "../../core/cx.ts";
import type { MenuItem } from "../../types/mod.ts";
import { Icon, ICON_PATHS, type IconName } from "../../icons/mod.ts";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";
import { Avatar } from "../../display/components/Avatar.tsx";
import { isSeparator, itemKey } from "../core/menu.ts";
import { isEmptyRow, isSubmenu, opensOnContextMenu } from "../core/menu-tree.ts";

// #region Props
/** Row event handlers, each receiving the row's index within its level. */
export interface ActionMenuRowHandlers {
	onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLElement>, index: number) => void;
	onKeyUp: (event: JSX.TargetedKeyboardEvent<HTMLElement>) => void;
	onClick: (event: JSX.TargetedMouseEvent<HTMLElement>, index: number) => void;
}

/** Props for {@link ActionMenuRows}. */
export interface ActionMenuRowsProps {
	/** The level's visible rows. */
	items: MenuItem[];
	/** The level panel's id; row ids derive from it. */
	levelId: string;
	/** Index of the row whose submenu is open at this level, or -1. */
	openIndex: number;
	/** Id of the open flyout, wired to the open parent's `aria-controls`. */
	flyoutId: string | null;
	handlers: ActionMenuRowHandlers;
	/** Close the whole menu, for a row's custom `content`. */
	onClose: () => void;
}
// #endregion

function isIconName(name: string | undefined): name is IconName {
	return !!name && Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
}

/** The DOM id of row `index` in level `levelId`. */
export function actionMenuRowId(levelId: string, index: number): string {
	return `${levelId}-r${index}`;
}

/**
 * The rows of one ActionMenu level: `role="menuitem"` buttons (anchors for `url` rows, split parents
 * included), a leading `image` avatar in place of the icon when given, hairline
 * separators, and parent rows advertising `aria-haspopup`/`aria-expanded`/`aria-controls` with a
 * caret. Disabled rows stay focusable (`aria-disabled`) and explain themselves through a Tooltip
 * plus `aria-describedby`. Presentational only — every behaviour arrives through `handlers`.
 */
export function ActionMenuRows(props: ActionMenuRowsProps): JSX.Element {
	const { items, levelId, openIndex, flyoutId, handlers, onClose } = props;

	const renderRow = (item: MenuItem, index: number): VNode => {
		const id = actionMenuRowId(levelId, index);

		// No `data-index`: the row is not a hover target, or a pointer crossing it would pull focus in.
		if (item.content) {
			return (
				<div
					key={itemKey(item, index)}
					id={id}
					role="group"
					aria-label={item.label}
					tabIndex={-1}
					class="ui-action-menu__content"
					onKeyDown={(e) => handlers.onKeyDown(e, index)}
					onFocus={({ currentTarget: group }) =>
						(group.querySelector<HTMLElement>('[aria-checked="true"]') ??
							group.querySelector<HTMLElement>("button"))?.focus()}
				>
					{item.content(onClose)}
				</div>
			);
		}

		const parent = isSubmenu(item);
		const open = parent && openIndex === index;
		const empty = isEmptyRow(item);
		const reason = item.disabled && item.disabledReason ? item.disabledReason : null;
		const reasonId = reason ? `${id}-reason` : undefined;

		const content = (
			<>
				{item.image !== undefined
					? <Avatar image={item.image} label={item.label} size="sm" class="ui-action-menu__image" />
					: isIconName(item.icon) && <Icon name={item.icon} size="sm" class="ui-menu-item__icon" />}
				<span class="ui-action-menu__text">
					<span class="ui-action-menu__label">{item.label}</span>
					{item.hint && <span class="ui-action-menu__hint">{item.hint}</span>}
				</span>
				{item.shortcut && <span class="ui-action-menu__shortcut">{item.shortcut}</span>}
				{item.badge != null && <span class="ui-action-menu__badge">{item.badge}</span>}
				{parent && !opensOnContextMenu(item) && (
					<Icon name="chevron-right" size="sm" class="ui-action-menu__caret" />
				)}
				{reason && <span id={reasonId} hidden>{reason}</span>}
			</>
		);

		const shared = {
			id,
			role: "menuitem" as const,
			tabIndex: -1,
			"data-index": index,
			class: cx(
				"ui-menu-item ui-action-menu__item",
				parent && "ui-action-menu__item--parent",
				item.danger && "ui-menu-item--danger ui-action-menu__item--danger",
				item.disabled && "ui-action-menu__item--disabled",
				empty && "ui-action-menu__item--empty",
				item.class,
			),
			"aria-disabled": item.disabled ? ("true" as const) : undefined,
			"aria-haspopup": parent ? ("menu" as const) : undefined,
			"aria-expanded": parent ? open : undefined,
			"aria-controls": open && flyoutId ? flyoutId : undefined,
			"aria-describedby": reasonId,
			onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLElement>) => handlers.onKeyDown(e, index),
			onKeyUp: handlers.onKeyUp,
			onClick: (e: JSX.TargetedMouseEvent<HTMLElement>) => handlers.onClick(e, index),
		};

		// Every `url` row is an anchor — a split parent included — so a middle-click opens a new tab.
		const row = item.url
			? (
				<a
					{...shared}
					href={item.disabled ? undefined : item.url}
					target={item.target}
					rel={item.target === "_blank" ? "noopener" : undefined}
				>
					{content}
				</a>
			)
			: (
				<button type="button" {...shared}>
					{content}
				</button>
			);

		return reason
			? <Tooltip key={itemKey(item, index)} content={reason}>{row}</Tooltip>
			: <span key={itemKey(item, index)} class="ui-action-menu__slot">{row}</span>;
	};

	return (
		<>
			{items.map((item, index) =>
				isSeparator(item)
					? <div key={`sep-${index}`} role="separator" class="ui-menu-separator" />
					: renderRow(item, index)
			)}
		</>
	);
}
