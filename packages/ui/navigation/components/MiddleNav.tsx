import type { ComponentChildren, JSX } from "preact";
import "../styles/middle-nav.css";
import { ShellFrame } from "./ShellFrame.tsx";

export interface MiddleNavProps {
	/**
	 * The page-level nav lane (Blue): comms lists, workspace filters, stage channels. Wrap it in the
	 * `MiddleNavSplitter` island to make it drag-resizable (Part D.2).
	 */
	lane?: ComponentChildren;
	/** See {@link ShellFrame.flushBottom}. */
	flushBottom?: boolean;
	/** Nested content — a PageCanvas (Green). */
	children?: ComponentChildren;
}

/**
 * MiddleNav — the Blue zone: a page-level middle navigation lane nested within the Red shell, framing
 * the Green canvas. A `--surface-1` ShellFrame with the exposed-corner curvature.
 */
export function MiddleNav({ lane, flushBottom = true, children }: MiddleNavProps): JSX.Element {
	return (
		<ShellFrame surface={1} flushBottom={flushBottom} class="ui-middle-nav">
			{lane ? <div class="ui-middle-nav__lane">{lane}</div> : null}
			<div class="ui-middle-nav__content">{children}</div>
		</ShellFrame>
	);
}
