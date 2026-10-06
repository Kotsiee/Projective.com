import type { ComponentChildren, JSX } from "preact";
import "../styles/page-canvas.css";
import { ShellFrame } from "./ShellFrame.tsx";

/** The `id` the canvas's main landmark carries unless told otherwise — `AppShell`'s `skipTo` target. */
export const PAGE_CANVAS_MAIN_ID = "main-content";

export interface PageCanvasProps {
	/** See {@link ShellFrame.flushBottom}. */
	flushBottom?: boolean;
	/** The main landmark's `id`, which a "Skip to content" link targets. Defaults to `main-content`. */
	mainId?: string;
	/** The actual page — feeds, boards, master-detail views. */
	children?: ComponentChildren;
}

/**
 * PageCanvas — the Green zone: the central stage where pages render. A `--surface` ShellFrame nested
 * within the Blue lane (or directly within the Red shell when no MiddleNav is present). Flows in the
 * native window scroll (Part D, Decision #31) — the inner `.ui-page-canvas__body` is a plain content
 * wrapper, NOT a scroll container (the window owns the single main scrollbar).
 *
 * The inner body is the page's `<main>` landmark (Decision #144): the one region assistive technology
 * should be able to jump to, and the target of the shell's Skip to content link. `tabIndex={-1}` makes
 * it focusable by script and by that link without adding a Tab stop, so activating the skip link moves
 * the keyboard's starting point into the page rather than only scrolling to it.
 *
 * A route-configured header/footer is NOT a PageCanvas concern: they mount one level up, as the
 * MiddleNav frame's `header`/`footer` bands (DESIGN_SYSTEM.md §D.4), so they span flush against the lane
 * and read as connected strips across the whole middle-nav frame rather than floating inside this pane.
 */
export function PageCanvas(
	{ flushBottom = true, mainId = PAGE_CANVAS_MAIN_ID, children }: PageCanvasProps,
): JSX.Element {
	return (
		<ShellFrame surface={0} flushBottom={flushBottom} class="ui-page-canvas">
			<main id={mainId} class="ui-page-canvas__body" tabIndex={-1}>{children}</main>
		</ShellFrame>
	);
}
