import type { ComponentChildren, JSX } from "preact";
import "../styles/page-canvas.css";
import { ShellFrame } from "./ShellFrame.tsx";

export interface PageCanvasProps {
	/** See {@link ShellFrame.flushBottom}. */
	flushBottom?: boolean;
	/** The actual page — feeds, boards, master-detail views. */
	children?: ComponentChildren;
}

/**
 * PageCanvas — the Green zone: the central stage where pages render. A `--surface` ShellFrame nested
 * within the Blue lane (or directly within the Red shell when no MiddleNav is present). Flows in the
 * native window scroll (Part D, Decision #31) — the inner `.ui-page-canvas__body` is a plain content
 * wrapper, NOT a scroll container (the window owns the single main scrollbar).
 *
 * A route-configured header/footer is NOT a PageCanvas concern: they mount one level up, as the
 * MiddleNav frame's `header`/`footer` bands (DESIGN_SYSTEM.md §D.4), so they span flush against the lane
 * and read as connected strips across the whole middle-nav frame rather than floating inside this pane.
 */
export function PageCanvas({ flushBottom = true, children }: PageCanvasProps): JSX.Element {
	return (
		<ShellFrame surface={0} flushBottom={flushBottom} class="ui-page-canvas">
			<div class="ui-page-canvas__body">{children}</div>
		</ShellFrame>
	);
}
