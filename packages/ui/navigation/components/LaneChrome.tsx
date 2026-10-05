import type { ComponentChildren, JSX, RefObject, VNode } from "preact";
import "../styles/lane.css";
import { cx } from "../../core/cx.ts";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";

/**
 * Lane chrome — the shared control set every middle-nav lane is built from, so the `/projects` feed,
 * the `/projects/[id]` details sidebar, and the `/messages` inbox render ONE vocabulary rather than
 * three lookalikes: {@link LaneHead} / {@link LaneFooter} bands, {@link LaneTabs}, {@link LaneSearch},
 * {@link LaneIconButton}, {@link LaneToggleRow}, {@link LaneSection}, {@link LaneCollapseButton}, and
 * {@link LaneEmpty}.
 *
 * Every control is icon-first and labelled by a portal {@link Tooltip} + `aria-label` — never a native
 * `title` (DESIGN_SYSTEM.md §B.6). Presentation lives entirely in `styles/lane.css` (`.ui-lane-*`), so
 * a consumer never restyles a control locally; it composes one.
 *
 * These are dumb, fully-controlled components: they own no state and read no app data, keeping the
 * package portable (packages/ui CLAUDE.md).
 */

// #region Bands
/** The lane's pinned header band — tabs, search, and filter rows stack inside it. */
export function LaneHead(
	{ class: className, children }: { class?: string; children: ComponentChildren },
): JSX.Element {
	return <div class={cx("ui-lane-head", className)}>{children}</div>;
}

/** The lane's pinned footer band — the collapse toggle (leading) + an action cluster (trailing). */
export function LaneFooter(
	{ class: className, children }: { class?: string; children: ComponentChildren },
): JSX.Element {
	return <div class={cx("ui-lane-footer", className)}>{children}</div>;
}

/** The trailing action cluster inside a {@link LaneFooter}. */
export function LaneFooterActions(
	{ children }: { children: ComponentChildren },
): JSX.Element {
	return <div class="ui-lane-footer__actions">{children}</div>;
}

/**
 * The lane's scrolling body between the two bands. Extra attributes are spread onto the root so a
 * consumer can, for example, opt the whole list into its framework's client-side navigation.
 */
export function LaneList(
	{ label, busy, class: className, children, ...rest }:
		& { label?: string; busy?: boolean; class?: string; children: ComponentChildren }
		& Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "children">,
): JSX.Element {
	return (
		<div
			class={cx("ui-lane-list", className)}
			aria-label={label}
			aria-busy={busy ? "true" : undefined}
			{...rest}
		>
			{children}
		</div>
	);
}
// #endregion

// #region Tabs
/** One option in a {@link LaneTabs} strip. */
export interface LaneTabOption<T extends string = string> {
	value: T;
	label: string;
	/** A quiet unseen-activity dot after the label (§D.1 — a dot, never a count). */
	dot?: boolean;
	/** Words added to the tab's accessible name only — the count a dot stands for ("3 unread"). */
	hint?: string;
}

export interface LaneTabsProps<T extends string = string> {
	/** Accessible name for the tablist. */
	label: string;
	/** Currently-selected tab value. */
	value: T;
	options: readonly LaneTabOption<T>[];
	onSelect: (value: T) => void;
	class?: string;
}

/**
 * LaneTabs — the plain-language tab strip at the peak of a lane. A quiet sliding underline marks the
 * active tab; no filled pill, no count (§B.4 — no boxes on non-interactive chrome). A tab may carry an
 * unseen-activity dot, with the count it stands for spoken in its name. Arrow keys, Home and End move
 * between tabs (roving tab stop), per the ARIA tabs pattern.
 */
export function LaneTabs<T extends string = string>(props: LaneTabsProps<T>): JSX.Element {
	const onKeyDown = (event: KeyboardEvent) => {
		const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
		if (!keys.includes(event.key)) return;
		const tabs = Array.from(
			(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("[role='tab']"),
		);
		const at = tabs.indexOf(event.target as HTMLButtonElement);
		if (at < 0) return;
		event.preventDefault();
		const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === "rtl";
		const forward = (event.key === "ArrowRight") !== rtl;
		const next = event.key === "Home"
			? 0
			: event.key === "End"
			? tabs.length - 1
			: (at + (forward ? 1 : -1) + tabs.length) % tabs.length;
		tabs[next].focus();
		props.onSelect(props.options[next].value);
	};
	return (
		<div
			class={cx("ui-lane-tabs", props.class)}
			role="tablist"
			aria-label={props.label}
			onKeyDown={onKeyDown}
		>
			{props.options.map((tab) => {
				const selected = props.value === tab.value;
				return (
					<button
						key={tab.value}
						type="button"
						role="tab"
						aria-selected={selected}
						tabIndex={selected ? 0 : -1}
						class="ui-lane-tabs__tab"
						data-selected={selected ? "true" : undefined}
						onClick={() => props.onSelect(tab.value)}
					>
						{tab.label}
						{tab.dot && <span class="ui-lane-tabs__dot" aria-hidden="true" />}
						{tab.hint && <span class="ui-visually-hidden">{`, ${tab.hint}`}</span>}
					</button>
				);
			})}
		</div>
	);
}
// #endregion

// #region Create action
export interface LaneCreateButtonProps {
	/** The action, as words ("New message", "Create project"); also its accessible name. */
	label: string;
	/** The leading glyph, supplied by the consumer so the package carries no icon set. */
	icon: VNode;
	/** Anchor ref when the button opens an overlay (see {@link LaneIconButtonProps.triggerRef}). */
	triggerRef?: RefObject<HTMLElement>;
	ariaHasPopup?: "menu" | "dialog";
	ariaExpanded?: boolean;
	ariaControls?: string;
	class?: string;
	onClick?: () => void;
}

/**
 * LaneCreateButton — a lane's ONE primary action, the filled brand pill in its footer band ("New
 * message", "Create project"), so every lane spells its create action the same way. The brand fill
 * takes the §B.12 zero tonal step (its hover is the border channel) and a press compresses by scale
 * only; in the collapsed rail the label folds away and the glyph stays, named by `aria-label`.
 */
export function LaneCreateButton(props: LaneCreateButtonProps): JSX.Element {
	return (
		<button
			type="button"
			ref={props.triggerRef as RefObject<HTMLButtonElement> | undefined}
			class={cx("ui-lane-create", props.class)}
			aria-label={props.label}
			aria-haspopup={props.ariaHasPopup}
			aria-expanded={props.ariaExpanded}
			aria-controls={props.ariaControls}
			onClick={props.onClick}
		>
			<span class="ui-lane-create__icon" aria-hidden="true">{props.icon}</span>
			<span class="ui-lane-create__label" aria-hidden="true">{props.label}</span>
		</button>
	);
}
// #endregion

// #region Search
export interface LaneSearchProps {
	value: string;
	placeholder: string;
	/** Accessible name (default `"Search"`). */
	label?: string;
	/** The leading magnifier glyph — supplied by the consumer so the package carries no icon set. */
	icon: VNode;
	onInput: (value: string) => void;
}

/**
 * LaneSearch — the lane's pill search field with a leading, pointer-transparent glyph. The full border
 * on focus is permitted: this is an interactive control (§B.4).
 */
export function LaneSearch(props: LaneSearchProps): JSX.Element {
	return (
		<div class="ui-lane-search">
			<span class="ui-lane-search__icon" aria-hidden="true">{props.icon}</span>
			<input
				class="ui-lane-search__input"
				type="search"
				placeholder={props.placeholder}
				aria-label={props.label ?? "Search"}
				value={props.value}
				onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
			/>
		</div>
	);
}

/** The lane's search row — a growing {@link LaneSearch} beside its trailing icon actions. */
export function LaneBar({ children }: { children: ComponentChildren }): JSX.Element {
	return <div class="ui-lane-bar">{children}</div>;
}
// #endregion

// #region Icon button
export interface LaneIconButtonProps {
	icon: VNode;
	/** Accessible name — also the tooltip text unless {@link tooltip} overrides it. */
	label: string;
	/** Tooltip text (defaults to {@link label}); pass `null` to suppress the tooltip entirely. */
	tooltip?: string | null;
	tooltipPlacement?: "top" | "bottom" | "left" | "right";
	/** Accent (engaged) state — tints the glyph with `--primary`. */
	active?: boolean;
	/** Render the small corner dot (an active-filter/unseen signal, never a count — §D.1). */
	dot?: boolean;
	/** Persistent accent styling (a primary action such as Compose), independent of {@link active}. */
	accent?: boolean;
	/**
	 * Anchor ref for an overlay trigger. Named (not `ref`) because Preact does not forward `ref`
	 * through a function component without `preact/compat`, which this package deliberately avoids.
	 */
	triggerRef?: RefObject<HTMLElement>;
	/** Reflected as `aria-pressed` for toggle semantics. */
	pressed?: boolean;
	ariaHasPopup?: "menu" | "dialog" | "listbox";
	ariaExpanded?: boolean;
	ariaControls?: string;
	class?: string;
	onClick?: () => void;
	/**
	 * Render a LINK instead of a button — for an icon-only control that navigates (a lane footer's
	 * "project details"). A destination is a link, not a button that assigns `location`: it opens in a
	 * new tab, shows its URL, and is announced as what it is. {@link active} then also marks it
	 * `aria-current="page"`; the toggle/popup props are ignored, since a link is neither.
	 */
	href?: string;
}

/**
 * LaneIconButton — the lane's circular icon-only control (search filters, compose, settings, kebab).
 * Always carries an `aria-label` and, unless suppressed, a portal {@link Tooltip} (§B.6). With `href`
 * it is the same control as a link.
 */
export function LaneIconButton(props: LaneIconButtonProps): JSX.Element {
	const button = props.href !== undefined
		? (
			<a
				href={props.href}
				ref={props.triggerRef as RefObject<HTMLAnchorElement> | undefined}
				class={cx("ui-lane-iconbtn", props.accent && "ui-lane-iconbtn--accent", props.class)}
				data-on={props.active ? "true" : undefined}
				aria-label={props.label}
				aria-current={props.active ? "page" : undefined}
				onClick={props.onClick}
			>
				{props.icon}
				{props.dot && <span class="ui-lane-iconbtn__dot" aria-hidden="true" />}
			</a>
		)
		: (
			<button
				type="button"
				ref={props.triggerRef as RefObject<HTMLButtonElement> | undefined}
				class={cx("ui-lane-iconbtn", props.accent && "ui-lane-iconbtn--accent", props.class)}
				data-on={props.active ? "true" : undefined}
				data-open={props.ariaExpanded ? "true" : undefined}
				aria-label={props.label}
				aria-pressed={props.pressed}
				aria-haspopup={props.ariaHasPopup}
				aria-expanded={props.ariaExpanded}
				aria-controls={props.ariaControls}
				onClick={props.onClick}
			>
				{props.icon}
				{props.dot && <span class="ui-lane-iconbtn__dot" aria-hidden="true" />}
			</button>
		);

	if (props.tooltip === null) return button;
	return (
		<Tooltip content={props.tooltip ?? props.label} placement={props.tooltipPlacement ?? "bottom"}>
			{button}
		</Tooltip>
	);
}
// #endregion

// #region Quick-filter toggle row
/** One toggle in a {@link LaneToggleRow}. */
export interface LaneToggleOption<T extends string = string> {
	key: T;
	label: string;
	icon: VNode;
}

/** One icon-toggle group — the primary group of a {@link LaneToggleRow}, or its opposite-side trailing group. */
export interface LaneToggleGroupSpec<T extends string = string> {
	/** Accessible name for the group. */
	label: string;
	options: readonly LaneToggleOption<T>[];
	/** Currently-engaged keys (OR-combined by the consumer). */
	active: readonly T[];
	onToggle: (key: T) => void;
}

export interface LaneToggleRowProps<T extends string = string, U extends string = string>
	extends LaneToggleGroupSpec<T> {
	/**
	 * An optional SECOND group rendered on the OPPOSITE side of the SAME horizontal row — the row then
	 * spreads the two groups `space-between` (a single group stays right-aligned). Lets a lane carry two
	 * related toggle sets (e.g. inbox partitions ⟷ quick filters) on one line rather than stacked rows.
	 */
	trailing?: LaneToggleGroupSpec<U>;
}

/** The inner `.ui-lane-toggles__group` — the buttons themselves. Shared by the primary + trailing groups. */
function LaneToggleGroup<T extends string>(group: LaneToggleGroupSpec<T>): JSX.Element {
	const set = new Set(group.active);
	return (
		<div class="ui-lane-toggles__group">
			{group.options.map((o) => {
				const on = set.has(o.key);
				return (
					<Tooltip key={o.key} content={o.label} placement="bottom">
						<button
							type="button"
							class="ui-lane-toggle"
							data-on={on ? "true" : undefined}
							aria-pressed={on}
							aria-label={`Show ${o.label.toLowerCase()} only`}
							onClick={() => group.onToggle(o.key)}
						>
							{o.icon}
						</button>
					</Tooltip>
				);
			})}
		</div>
	);
}

/**
 * LaneToggleRow — the permanent, icon-ONLY quick-filter row. Each toggle stays quiet until engaged
 * and is described by a portal {@link Tooltip}; no pills, no borders (§B.6 icon-first). Pass
 * {@link LaneToggleRowProps.trailing} to place a second group on the opposite side of the SAME row.
 */
export function LaneToggleRow<T extends string = string, U extends string = string>(
	props: LaneToggleRowProps<T, U>,
): JSX.Element {
	return (
		<div class="ui-lane-toggles" role="group" aria-label={props.label}>
			<LaneToggleGroup
				label={props.label}
				options={props.options}
				active={props.active}
				onToggle={props.onToggle}
			/>
			{props.trailing && <LaneToggleGroup {...props.trailing} />}
		</div>
	);
}
// #endregion

// #region Collapsible section
export interface LaneSectionProps {
	/** Stable id — derives the panel id the toggle controls. */
	id: string;
	icon: VNode;
	label: string;
	open: boolean;
	onToggle: () => void;
	/** Optional inline control in the header (e.g. a "＋" create action). */
	action?: ComponentChildren;
	/** Live-state dot when something inside is unread (§D.1 — a dot, never a count). */
	hasUnread?: boolean;
	children: ComponentChildren;
}

/**
 * LaneSection — one collapsible group of a lane accordion (channels, stages, teams, conversations).
 * Reveals via a `grid-template-rows: 0fr → 1fr` transition so the height animates; the panel stays in
 * the DOM and is marked `inert` while closed, keeping its links out of the tab order and the a11y
 * tree. Reduced motion jumps straight to the final state.
 */
export function LaneSection(props: LaneSectionProps): JSX.Element {
	const panelId = `ui-lane-section-${props.id}`;
	return (
		<div class="ui-lane-section" data-open={props.open ? "true" : undefined}>
			<div class="ui-lane-section__head">
				<button
					type="button"
					class="ui-lane-section__toggle"
					aria-expanded={props.open}
					aria-controls={panelId}
					onClick={props.onToggle}
				>
					<span class="ui-lane-section__chevron" aria-hidden="true">{CHEVRON}</span>
					<span class="ui-lane-section__icon" aria-hidden="true">{props.icon}</span>
					<span class="ui-lane-section__label">{props.label}</span>
					{props.hasUnread && (
						<span class="ui-lane-section__dot" role="status" aria-label="has unread items" />
					)}
				</button>
				{props.action && <span class="ui-lane-section__action">{props.action}</span>}
			</div>
			<div
				id={panelId}
				class="ui-lane-section__body"
				role="region"
				aria-label={props.label}
				{...(props.open ? {} : { inert: true })}
			>
				<div class="ui-lane-section__body-inner">{props.children}</div>
			</div>
		</div>
	);
}

/** The disclosure chevron — rotated 90° by CSS when the section is open. */
const CHEVRON: VNode = (
	<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" aria-hidden="true">
		<path
			d="M9 6l6 6-6 6"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
);

/**
 * The container for a stack of {@link LaneSection}s. Extra attributes are spread onto the root so a
 * consumer can, for example, opt the whole tree into its framework's client-side navigation without the
 * package needing to know about it.
 */
export function LaneSections(
	{ class: className, children, ...rest }:
		& { class?: string; children: ComponentChildren }
		& Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "children">,
): JSX.Element {
	return <div class={cx("ui-lane-sections", className)} {...rest}>{children}</div>;
}
// #endregion

// #region Collapse toggle
export interface LaneCollapseButtonProps {
	/** Whether the lane is currently collapsed — drives the glyph's morphing divider + the label. */
	collapsed: boolean;
	onToggle: () => void;
	/**
	 * The morphing toggle glyph. Supplied by the consumer (the app owns the rail's `SidebarToggleIcon`)
	 * so the package carries no icon set; `styles/lane.css` animates its `.shell-toggle__bar`.
	 */
	icon: VNode;
	/** Tooltip placement (default `top` — the button lives in the footer band). */
	tooltipPlacement?: "top" | "bottom" | "left" | "right";
}

/**
 * LaneCollapseButton — the lane's collapse/expand control, reusing the global rail's morphing glyph
 * and its divider slide so the two toggles read as the same control at two scales.
 *
 * Render it in BOTH presentations (the expanded footer and the collapsed rail): the visible button is
 * docked to the `.ui-splitter`'s block-end/inline-start corner, so every instance lands on the same
 * screen coordinates regardless of lane width, density, or an in-flight width transition. The
 * surrounding slot stays in flow to reserve the button's footprint in its host layout.
 */
export function LaneCollapseButton(props: LaneCollapseButtonProps): JSX.Element {
	const label = props.collapsed ? "Expand lane" : "Collapse lane";
	return (
		<span class="ui-lane-collapse-slot">
			<span class="ui-lane-collapse-dock">
				<Tooltip content={label} placement={props.tooltipPlacement ?? "top"}>
					<button
						type="button"
						class="ui-lane-collapse"
						data-collapsed={props.collapsed ? "true" : undefined}
						aria-label={label}
						aria-expanded={!props.collapsed}
						onClick={props.onToggle}
					>
						{props.icon}
					</button>
				</Tooltip>
			</span>
		</span>
	);
}
// #endregion

// #region Empty state
export interface LaneEmptyProps {
	title: string;
	note?: string;
	/** Optional leading glyph above the copy. */
	icon?: VNode;
}

/** LaneEmpty — the lane's calm zero-result state (no filters matched, nothing here yet). */
export function LaneEmpty(props: LaneEmptyProps): JSX.Element {
	return (
		<div class="ui-lane-empty" role="status">
			{props.icon && <span class="ui-lane-empty__glyph" aria-hidden="true">{props.icon}</span>}
			<p class="ui-lane-empty__title">{props.title}</p>
			{props.note && <p class="ui-lane-empty__note">{props.note}</p>}
		</div>
	);
}
// #endregion
