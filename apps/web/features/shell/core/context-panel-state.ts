import { signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * context-panel-state — the bridge between a header band's Details toggle and the middle-nav frame's
 * right context panel (separate hydration roots, one module). From 1280px the panel docks in the frame
 * (`MiddleNavPanel`) and its open state is remembered; below that the surface presents the same
 * content as a slide-over drawer that only opens when asked.
 *
 * One state for the shell, not one per surface: the frame has a single panel slot, so a conversation's
 * context and a channel's details are the same affordance and share the viewer's choice.
 */

/** The width from which the panel docks in the frame rather than sliding over it. */
export const CONTEXT_PANEL_INFLOW_QUERY = "(min-width: 1280px)";

/** The docked panel is open (wide viewports). */
export const contextPanelDocked = signal(true);

/** The slide-over drawer is open (narrow viewports). */
export const contextDrawerOpen = signal(false);

/** Re-apply the viewer's remembered docked choice after hydration. */
export function restoreContextPanel(): void {
	const raw = readStored("local", LocalKeys.CONTEXT_PANEL_DOCKED);
	if (raw === "0" || raw === "1") contextPanelDocked.value = raw === "1";
}

/** Whether the viewport currently docks the panel. */
export function contextPanelInflow(): boolean {
	return !!globalThis.matchMedia?.(CONTEXT_PANEL_INFLOW_QUERY).matches;
}

/**
 * Close the docked panel and remember it — the panel's own drag-to-close. The header's Details toggle
 * reads {@link contextPanelDocked}, so it returns to its inactive state with no further wiring.
 */
export function closeContextPanel(): void {
	contextPanelDocked.value = false;
	writeStored("local", LocalKeys.CONTEXT_PANEL_DOCKED, "0");
}

/** Toggle the panel in whichever form the viewport presents it. */
export function toggleContextPanel(): void {
	if (!contextPanelInflow()) {
		contextDrawerOpen.value = !contextDrawerOpen.value;
		return;
	}
	const next = !contextPanelDocked.value;
	contextPanelDocked.value = next;
	writeStored("local", LocalKeys.CONTEXT_PANEL_DOCKED, next ? "1" : "0");
}
