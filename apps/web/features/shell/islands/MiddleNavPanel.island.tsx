import type { ComponentChildren, JSX } from "preact";
import { useEffect } from "preact/hooks";
import { MiddleNavPanel as Panel } from "@projective/ui/navigation";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import {
	closeContextPanel,
	contextPanelDocked,
	restoreContextPanel,
} from "../core/context-panel-state.ts";

export interface MiddleNavPanelProps {
	/** The panel content a slot resolver registered (a conversation's context, a channel's details). */
	children?: ComponentChildren;
}

/**
 * Hydration wrapper for the package's drag-resizable middle-nav right panel (DESIGN_SYSTEM.md §D.4).
 * Supplies the app's registered width key, and drives `open` from the shell's shared docked state so
 * the header band's Details toggle (another hydration root) opens and closes it. Dragging the handle
 * well past the minimum width and releasing closes it through the same state, so that toggle reads
 * as inactive again. The live width is hoisted onto `.ui-middle-nav` as `--shell-panel-w`, where the
 * canvas surface reads it to stop at the panel's leading edge.
 */
export default function MiddleNavPanel(props: MiddleNavPanelProps): JSX.Element {
	useEffect(() => restoreContextPanel(), []);
	return (
		<Panel
			open={contextPanelDocked.value}
			storageKey={LocalKeys.CONTEXT_PANEL_WIDTH}
			handleLabel="Resize details panel"
			initial={320}
			min={280}
			max={520}
			onCollapse={closeContextPanel}
		>
			{props.children}
		</Panel>
	);
}
