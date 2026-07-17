import type { ComponentChildren, JSX } from "preact";
import "../styles/middle-nav.css";
import { cx } from "../../core/cx.ts";
import { ShellFrame } from "./ShellFrame.tsx";

export interface MiddleNavProps {
	/**
	 * The page-level nav lane (Blue): comms lists, workspace filters, stage channels. Wrap it in the
	 * `MiddleNavSplitter` island to make it drag-resizable (Part D.2).
	 */
	lane?: ComponentChildren;
	/**
	 * Optional configurable **frame header** — a sticky top band that spans the content column of the
	 * middle-nav frame and sits flush against the lane, so the lane's own header (Back/kebab) and this
	 * band read as ONE connected strip on the shared Blue surface + top curve (DESIGN_SYSTEM.md §D.4).
	 * It is the shell's single route-driven header slot: pages register content here via the layout
	 * (e.g. the channel view's `ChannelHeader`). When omitted the band is not rendered at all — the
	 * content body fills the top of the frame with no reserved space (no empty bar). The lane spans the
	 * full frame height beneath it, so the band never covers or offsets the lane.
	 */
	header?: ComponentChildren;
	/**
	 * Optional configurable **frame footer** — a sticky bottom band that spans the content column of the
	 * middle-nav frame and locks to the viewport bottom under the native window scroll (Decision #31), so
	 * it stays in view while the content feed scrolls beneath it. The shell's single route-driven footer
	 * slot: pages register content here via the layout (e.g. the channel Chat tab's `ChatComposer`). When
	 * omitted the band is not rendered at all — the content fills the frame bottom with no reserved space.
	 */
	footer?: ComponentChildren;
	/** See {@link ShellFrame.flushBottom}. */
	flushBottom?: boolean;
	/** Nested content — a PageCanvas (Green). */
	children?: ComponentChildren;
}

/**
 * MiddleNav — the Blue zone: a page-level middle navigation lane nested within the Red shell, framing
 * the Green canvas. A `--surface-1` ShellFrame with the exposed-corner curvature.
 *
 * Layout is a three-row grid: the {@link MiddleNavProps.lane} spans all rows on the left (so its own
 * sticky header/footer align into the bands), while the right column splits into the optional
 * {@link MiddleNavProps.header} band (row 1), the content canvas (row 2), and the optional
 * {@link MiddleNavProps.footer} band (row 3). An absent band's `auto` row collapses to 0, so the
 * content simply fills that edge (no empty bar).
 */
export function MiddleNav(
	{ lane, header, footer, flushBottom = true, children }: MiddleNavProps,
): JSX.Element {
	return (
		<ShellFrame
			surface={1}
			flushBottom={flushBottom}
			class={cx(
				"ui-middle-nav",
				!!header && "ui-middle-nav--has-header",
				!!footer && "ui-middle-nav--has-footer",
			)}
		>
			{lane ? <div class="ui-middle-nav__lane">{lane}</div> : null}
			{header ? <div class="ui-middle-nav__header">{header}</div> : null}
			<div class="ui-middle-nav__content">{children}</div>
			{footer ? <div class="ui-middle-nav__footer">{footer}</div> : null}
		</ShellFrame>
	);
}
