import type { JSX, RefObject } from "preact";
import { useRef } from "preact/hooks";
import type { InspectorShell } from "../core/inspector-shell.ts";
import { useIdleWake } from "../hooks/use-idle-wake.ts";
import { ToolButton } from "./controls/ToolButton.tsx";
import type { MountedViewer } from "./viewers/viewer.ts";

/** Props for {@link CanvasToolbar}. */
export interface CanvasToolbarProps {
	shell: InspectorShell;
	viewer: MountedViewer;
	/** Where pointer activity wakes the toolbar; the toolbar's own parent (the stage box) when omitted. */
	surface?: RefObject<HTMLElement>;
}

/**
 * The canvas's footer toolbar: its own chips once it is ready, then Fullscreen (Exit fullscreen in
 * the theater). It fades out after a moment without a hand on the canvas and is back the instant one
 * moves; hover, focus and an open menu keep it up. Absolutely positioned at the foot of its parent.
 */
export function CanvasToolbar({ shell, viewer, surface }: CanvasToolbarProps): JSX.Element {
	const bar = useRef<HTMLDivElement>(null);
	const awake = useIdleWake(bar, surface);
	const theater = shell.fullscreen.value;
	const Chips = shell.status.value === "ready" ? viewer.Chips : null;
	return (
		<div ref={bar} class="ins-footbar" data-awake={awake.value || undefined}>
			{Chips ? <Chips /> : null}
			<div class="ins-chips" role="toolbar" aria-label="View">
				<ToolButton
					icon={theater ? "collapse" : "expand"}
					label={theater ? "Exit fullscreen" : "Fullscreen"}
					shortcut={theater ? "Esc" : "F"}
					onClick={() => shell.toggleFullscreen()}
				/>
			</div>
		</div>
	);
}
