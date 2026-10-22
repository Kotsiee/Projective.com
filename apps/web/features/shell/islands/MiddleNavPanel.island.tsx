import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { MiddleNavPanel as Panel } from "@projective/ui/navigation";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import {
	closeContextPanel,
	type ContextPanelDock,
	contextPanelDocked,
	restoreContextPanel,
	selectionPanelOpen,
} from "../core/context-panel-state.ts";

export interface MiddleNavPanelProps {
	/** The panel content a slot resolver registered (a conversation's context, a channel's details). */
	children?: ComponentChildren;
	/** What opens the panel — the viewer's remembered Details choice (default) or a selection. */
	dock?: ContextPanelDock;
	/** `selection` only: the address names a selection, so the first paint shows the panel open. */
	open?: boolean;
}

/**
 * Hydration wrapper for the package's drag-resizable middle-nav right panel (DESIGN_SYSTEM.md §D.4).
 * Supplies the app's registered width key, and drives `open` from the shell's shared docked state so
 * the header band's Details toggle (another hydration root) opens and closes it. Dragging the handle
 * well past the minimum width and releasing closes it through the same state, so that toggle reads
 * as inactive again. The live width is hoisted onto `.ui-middle-nav` as `--shell-panel-w`, where the
 * canvas surface reads it to stop at the panel's leading edge.
 *
 * In `selection` dock the panel is an inspector: open exactly while its owner holds a selection
 * (`selectionPanelOpen`). Until every mount effect has run it keeps the server's `open`, so a deep link
 * paints docked in the first byte and the owner — not this frame — decides whether the address named
 * a real selection. A drag closes it without touching the remembered Details choice.
 */
export default function MiddleNavPanel(props: MiddleNavPanelProps): JSX.Element {
	const selection = props.dock === "selection";
	const hydrated = useSignal(false);
	useEffect(() => {
		if (!selection) {
			restoreContextPanel();
			return;
		}
		const handover = setTimeout(() => (hydrated.value = true), 0);
		return () => clearTimeout(handover);
	}, []);
	const open = selection
		? (hydrated.value ? selectionPanelOpen.value : props.open === true)
		: contextPanelDocked.value;
	return (
		<Panel
			open={open}
			storageKey={LocalKeys.CONTEXT_PANEL_WIDTH}
			handleLabel={selection ? "Resize inspector" : "Resize details panel"}
			initial={320}
			min={280}
			max={520}
			onCollapse={selection ? () => (selectionPanelOpen.value = false) : closeContextPanel}
		>
			{props.children}
		</Panel>
	);
}
