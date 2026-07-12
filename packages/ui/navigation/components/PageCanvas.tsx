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
 * within the Blue lane (or directly within the Red shell when no MiddleNav is present). Owns the main
 * scroll region.
 */
export function PageCanvas({ flushBottom = true, children }: PageCanvasProps): JSX.Element {
	return (
		<ShellFrame surface={0} flushBottom={flushBottom} class="ui-page-canvas">
			<div class="ui-page-canvas__scroll">{children}</div>
		</ShellFrame>
	);
}
