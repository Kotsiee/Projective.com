import type { ComponentChildren, JSX, RefObject, VNode } from "preact";
import type { Signal } from "@preact/signals";
import "../styles/lane-filter.css";
import { cx } from "../../core/cx.ts";
import { Popover } from "../../feedback/islands/Popover.tsx";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";
import { SortControl, type SortDirection } from "../../fields/islands/SortControl.tsx";
import type { BoundarySource } from "../../hooks/useFloating.ts";
import type { Placement } from "../../types/mod.ts";
import { LaneIconButton } from "./LaneChrome.tsx";

/**
 * Lane filter — the ONE filter popover every middle-nav lane opens from the ghost Filter button beside
 * its search: a {@link LaneFilterPopover} (trigger + panel with a plain Reset and an optional
 * {@link LaneFilterSortSpec} row), filled with {@link LaneFilterIcons} (icon-only multi-select),
 * {@link LaneFilterChoices} (worded multi- or single-select) and `LaneFilterCombo` (the tag selector
 * for teams and workspaces). Every change applies live; no facet draws a count (§D.1 — the trigger's
 * dot says the list is narrowed, its accessible name says by how many).
 */

const SHELL_AVOID: readonly BoundarySource[] = [".ui-app-shell__sidebar"];

// #region Popover
/** One sort property offered by a {@link LaneFilterSortSpec}. */
export interface LaneFilterSortOption<T extends string = string> {
	value: T;
	label: string;
}

/** The popover's sort row: the property dropdown and the direction toggle, both controlled. */
export interface LaneFilterSortSpec<T extends string = string> {
	options: readonly LaneFilterSortOption<T>[];
	value: T;
	direction: SortDirection;
	onSort: (value: T) => void;
	onDirection: (direction: SortDirection) => void;
}

/** Props for {@link LaneFilterPopover}. */
export interface LaneFilterPopoverProps<S extends string = string> {
	/** Open state, shared with the consumer so it can close the panel after a navigation. */
	open: Signal<boolean>;
	/** How many filters narrow the list: the trigger's dot and accessible name, never a drawn number. */
	active: number;
	/** The trigger's glyph, supplied by the consumer so the package carries no icon set. */
	icon: VNode;
	/** The panel heading and trigger tooltip (default `"Filters"`). */
	title?: string;
	/** Clears every filter the panel holds; offered only while {@link active} is above zero. */
	onReset?: () => void;
	sort?: LaneFilterSortSpec<S>;
	placement?: Placement;
	/** Layout zones the panel must not slide under (default: the app shell's sidebar). */
	avoid?: readonly BoundarySource[];
	class?: string;
	children?: ComponentChildren;
}

/**
 * LaneFilterPopover — the lane's Filter trigger (a ghost {@link LaneIconButton} with an active dot)
 * and the solid panel it opens: a heading with Reset, the sort row, then the consumer's facets.
 */
export function LaneFilterPopover<S extends string = string>(
	props: LaneFilterPopoverProps<S>,
): JSX.Element {
	const title = props.title ?? "Filters";
	const narrowed = props.active > 0;
	return (
		<Popover
			open={props.open}
			placement={props.placement ?? "bottom-end"}
			avoid={props.avoid ?? SHELL_AVOID}
			allowOverflow={["bottom"]}
			label={title}
			class={cx("ui-lane-filter-pop", props.class)}
			trigger={(api) => (
				<LaneIconButton
					triggerRef={api.ref as RefObject<HTMLElement>}
					icon={props.icon}
					label={narrowed ? `${title} (${props.active} active)` : title}
					tooltip={title}
					active={narrowed}
					dot={narrowed}
					ariaHasPopup="dialog"
					ariaExpanded={api.expanded}
					ariaControls={api.panelId}
					onClick={api.toggle}
				/>
			)}
		>
			<div class="ui-lane-filter">
				<header class="ui-lane-filter__head">
					<span class="ui-lane-filter__title">{title}</span>
					{narrowed && props.onReset && (
						<button type="button" class="ui-lane-filter__reset" onClick={props.onReset}>
							Reset
						</button>
					)}
				</header>
				{props.sort && <LaneFilterSort {...props.sort} />}
				{props.children}
			</div>
		</Popover>
	);
}

function LaneFilterSort<T extends string>(spec: LaneFilterSortSpec<T>): JSX.Element {
	const values = spec.options.map((o) => o.value as string);
	return (
		<LaneFilterFacet label="Sort by">
			<SortControl
				class="ui-lane-filter__sort"
				options={spec.options.map((o) => ({ value: o.value, label: o.label }))}
				value={spec.value}
				direction={spec.direction}
				onValueChange={(v) => {
					if (values.includes(v)) spec.onSort(v as T);
				}}
				onDirectionChange={spec.onDirection}
				size="sm"
				label="Sort"
				aria-label="Sort by"
			/>
		</LaneFilterFacet>
	);
}
// #endregion

// #region Facets
/** One labelled group inside the panel: a section-header register caption above its control. */
export function LaneFilterFacet(
	{ label, children }: { label: string; children: ComponentChildren },
): JSX.Element {
	return (
		<div class="ui-lane-filter__facet">
			<span class="ui-lane-filter__label">{label}</span>
			{children}
		</div>
	);
}

/** One option of an icon-only facet. */
export interface LaneFilterIconOption<T extends string = string> {
	value: T;
	label: string;
	icon: VNode;
}

/** Props for {@link LaneFilterIcons}. */
export interface LaneFilterIconsProps<T extends string = string> {
	label: string;
	options: readonly LaneFilterIconOption<T>[];
	active: readonly T[];
	onToggle: (value: T) => void;
}

/**
 * LaneFilterIcons — a multi-select facet of icon-only ghost toggles, each named by `aria-label` and
 * a portal {@link Tooltip}; an engaged toggle takes the `--primary` ink.
 */
export function LaneFilterIcons<T extends string>(props: LaneFilterIconsProps<T>): JSX.Element {
	const on = new Set(props.active);
	return (
		<LaneFilterFacet label={props.label}>
			<div class="ui-lane-filter-icons" role="group" aria-label={props.label}>
				{props.options.map((opt) => (
					<Tooltip key={opt.value} content={opt.label} placement="bottom">
						<button
							type="button"
							class="ui-lane-filter-icons__btn"
							data-on={on.has(opt.value) ? "true" : undefined}
							aria-pressed={on.has(opt.value)}
							aria-label={opt.label}
							onClick={() => props.onToggle(opt.value)}
						>
							{opt.icon}
						</button>
					</Tooltip>
				))}
			</div>
		</LaneFilterFacet>
	);
}

/** One option of a worded facet. */
export interface LaneFilterChoice<T extends string = string> {
	value: T;
	label: string;
}

/** Props for {@link LaneFilterChoices}. */
export interface LaneFilterChoicesProps<T extends string = string> {
	label: string;
	options: readonly LaneFilterChoice<T>[];
	active: readonly T[];
	onToggle: (value: T) => void;
	/** One value at a time (a radio group) rather than a multi-select. */
	single?: boolean;
}

/** LaneFilterChoices — a borderless worded facet for options that need their names. */
export function LaneFilterChoices<T extends string>(props: LaneFilterChoicesProps<T>): JSX.Element {
	const on = new Set(props.active);
	return (
		<LaneFilterFacet label={props.label}>
			<div
				class="ui-lane-filter-choices"
				role={props.single ? "radiogroup" : "group"}
				aria-label={props.label}
			>
				{props.options.map((opt) => (
					<button
						key={opt.value}
						type="button"
						class="ui-lane-filter-choices__opt"
						role={props.single ? "radio" : undefined}
						aria-checked={props.single ? on.has(opt.value) : undefined}
						aria-pressed={props.single ? undefined : on.has(opt.value)}
						data-on={on.has(opt.value) ? "true" : undefined}
						onClick={() => props.onToggle(opt.value)}
					>
						{opt.label}
					</button>
				))}
			</div>
		</LaneFilterFacet>
	);
}
// #endregion
