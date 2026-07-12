import type { ComponentChildren, CSSProperties, HTMLAttributes, JSX } from "preact";
import "../styles/toolbar.css";
import { cx } from "../../core/cx.ts";

export type ToolbarOrientation = "horizontal" | "vertical";

export interface ToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> {
	/** Leading group (left/top). Renders alongside `center`/`end` as three flex groups. */
	start?: ComponentChildren;
	/** Centered group. */
	center?: ComponentChildren;
	/** Trailing group (right/bottom). */
	end?: ComponentChildren;
	/** Axis the toolbar lays out along (default `horizontal`). */
	orientation?: ToolbarOrientation;
	style?: CSSProperties;
	/**
	 * Bare content, used instead of `start`/`center`/`end` when the toolbar has a single unsplit
	 * group of actions.
	 */
	children?: ComponentChildren;
}

/**
 * Toolbar — a zero-JS action bar. Pass `start`/`center`/`end` slots for a three-group layout (the
 * common "left tools · title · right tools" arrangement), or plain `children` for a single group.
 * Wraps responsively; groups never overlap. `role="toolbar"` + `aria-orientation` are set for
 * assistive tech; arrow-key roving focus is left to the caller's own controls (this component is
 * intentionally static — see `Toolbar` in DESIGN_SYSTEM.md §C.1).
 */
export function Toolbar(props: ToolbarProps): JSX.Element {
	const {
		start,
		center,
		end,
		orientation = "horizontal",
		class: className,
		style,
		children,
		...rest
	} = props;

	const hasGroups = start !== undefined || center !== undefined || end !== undefined;

	return (
		<div
			class={cx("ui-toolbar", `ui-toolbar--${orientation}`, className as string)}
			style={style}
			role="toolbar"
			aria-orientation={orientation}
			{...rest}
		>
			{hasGroups
				? (
					<>
						<div class="ui-toolbar__group ui-toolbar__group--start">{start}</div>
						<div class="ui-toolbar__group ui-toolbar__group--center">{center}</div>
						<div class="ui-toolbar__group ui-toolbar__group--end">{end}</div>
					</>
				)
				: children}
		</div>
	);
}
