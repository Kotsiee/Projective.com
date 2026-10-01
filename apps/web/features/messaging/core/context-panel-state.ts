import { signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * context-panel-state — the bridge between the conversation header's Details toggle and the context
 * panel island beside the thread (two hydration roots, one module). From 1280px the panel stands in
 * the flow and its open state is remembered; below that it slides over as a drawer that only opens
 * when asked.
 */

/** The width from which the panel stands beside the thread rather than over it. */
export const CONTEXT_PANEL_INFLOW_QUERY = "(min-width: 1280px)";

/** The in-flow panel is open (wide viewports). */
export const contextPanelDocked = signal(true);

/** The slide-over drawer is open (narrow viewports). */
export const contextDrawerOpen = signal(false);

/** Re-apply the viewer's remembered in-flow choice after hydration. */
export function restoreContextPanel(): void {
	const raw = readStored("local", LocalKeys.CONVERSATION_CONTEXT_PANEL);
	if (raw === "0" || raw === "1") contextPanelDocked.value = raw === "1";
}

/** Toggle the panel in whichever form the viewport presents it. */
export function toggleContextPanel(): void {
	if (!globalThis.matchMedia?.(CONTEXT_PANEL_INFLOW_QUERY).matches) {
		contextDrawerOpen.value = !contextDrawerOpen.value;
		return;
	}
	const next = !contextPanelDocked.value;
	contextPanelDocked.value = next;
	writeStored("local", LocalKeys.CONVERSATION_CONTEXT_PANEL, next ? "1" : "0");
}
