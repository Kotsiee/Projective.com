import type { JSX, RefObject, VNode } from "preact";
import type { Signal } from "@preact/signals";
import "../styles/lane-create-menu.css";
import { cx } from "../../core/cx.ts";
import { Popover } from "../../feedback/islands/Popover.tsx";
import type { BoundarySource } from "../../hooks/useFloating.ts";
import type { Placement } from "../../types/mod.ts";
import { LaneCreateButton } from "./LaneChrome.tsx";

/**
 * Lane create menu — the ONE popover a lane's {@link LaneCreateButton} opens when the lane can create
 * more than one kind of thing: a section-header caption over glyph-led rows, each naming only what it
 * makes. A row either runs its action (the popover closes first) or, with `href`, is a link to the
 * page whose create flow mounts the modal.
 */

const SHELL_AVOID: readonly BoundarySource[] = [".ui-app-shell__sidebar"];

/** One row of a {@link LaneCreateMenu}. */
export interface LaneCreateMenuItem {
	key: string;
	label: string;
	/** The row's leading glyph, supplied by the consumer so the package carries no icon set. */
	icon: VNode;
	/** Runs after the popover closes. Ignored when {@link href} is set. */
	onSelect?: () => void;
	/** Render the row as a link to a page instead of a button. */
	href?: string;
}

/** Props for {@link LaneCreateMenu}. */
export interface LaneCreateMenuProps {
	/** Open state, shared with the consumer so it can close the panel itself. */
	open: Signal<boolean>;
	/** The trigger's words ("Create project", "New listing"); also its accessible name. */
	label: string;
	/** The trigger's leading glyph. */
	icon: VNode;
	items: readonly LaneCreateMenuItem[];
	/** The caption above the rows (default `"Create"`). */
	heading?: string;
	placement?: Placement;
	/** Layout zones the panel must not slide under (default: the app shell's sidebar). */
	avoid?: readonly BoundarySource[];
	class?: string;
}

/**
 * LaneCreateMenu — the lane footer's {@link LaneCreateButton} and the menu of create choices it opens.
 */
export function LaneCreateMenu(props: LaneCreateMenuProps): JSX.Element {
	const heading = props.heading ?? "Create";
	return (
		<Popover
			open={props.open}
			placement={props.placement ?? "top-end"}
			avoid={props.avoid ?? SHELL_AVOID}
			allowOverflow={["top"]}
			class={cx("ui-lane-createmenu-pop", props.class)}
			trigger={(api) => (
				<LaneCreateButton
					triggerRef={api.ref as RefObject<HTMLElement>}
					label={props.label}
					icon={props.icon}
					ariaHasPopup="menu"
					ariaExpanded={api.expanded}
					ariaControls={api.panelId}
					onClick={api.toggle}
				/>
			)}
		>
			<div class="ui-lane-createmenu" role="menu" aria-label={props.label}>
				<span class="ui-lane-createmenu__head" aria-hidden="true">{heading}</span>
				{props.items.map((item) => {
					const content = (
						<>
							<span class="ui-lane-createmenu__icon" aria-hidden="true">{item.icon}</span>
							<span class="ui-lane-createmenu__label">{item.label}</span>
						</>
					);
					return item.href !== undefined
						? (
							<a key={item.key} role="menuitem" class="ui-lane-createmenu__item" href={item.href}>
								{content}
							</a>
						)
						: (
							<button
								key={item.key}
								type="button"
								role="menuitem"
								class="ui-lane-createmenu__item"
								onClick={() => {
									props.open.value = false;
									item.onSelect?.();
								}}
							>
								{content}
							</button>
						);
				})}
			</div>
		</Popover>
	);
}
