import type { ComponentChildren, JSX } from "preact";
import "../styles/splitter.css";
import { styleVars } from "../../core/style.ts";
import { useSplitter, type UseSplitterOptions } from "../hooks/useSplitter.ts";

export interface MiddleNavSplitterProps extends UseSplitterOptions {
	/** The lane content (comms lists, filters, channels). */
	children?: ComponentChildren;
}

/**
 * MiddleNavSplitter — drag-resizable wrapper for the Blue lane (DESIGN_SYSTEM.md Part D.2). Sets the
 * lane width via `--shell-lane-w` and exposes a density `data-mode` (collapsed → compact → full) so
 * the lane can reflow between icon-only, icon-matrix, and master-detail layouts.
 *
 * Interactive — hydrate it in the app via a `features/<group>/islands/` wrapper.
 */
export function MiddleNavSplitter(props: MiddleNavSplitterProps): JSX.Element {
	const { children, ...opts } = props;
	const { width, mode, onPointerDown, onPointerMove, onPointerUp } = useSplitter({
		storageKey: "shell.lane.w",
		...opts,
	});
	return (
		<div
			class="ui-splitter"
			data-mode={mode.value}
			style={styleVars({ "--shell-lane-w": `${width.value}px` })}
		>
			<div class="ui-splitter__body">{children}</div>
			<div
				class="ui-splitter__handle"
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize navigation lane"
				tabIndex={0}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			/>
		</div>
	);
}
