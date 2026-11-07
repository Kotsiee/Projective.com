import { signal } from "@preact/signals";
import { contextPanelInflow } from "@web/features/shell/core/context-panel-state.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * details-panel — whether the `/files` details panel is open, apart from what is selected.
 *
 * The panel is the middle-nav frame's right panel in its `selection` dock, but what opens it here is
 * the person, not the pick: the header band's Details toggle (and `Ctrl/⌘+I`). While it is open a
 * single click streams the picked file into it; while it is closed a click only selects, and a double
 * click opens the full preview. What it describes is still `files-state.inspectId`, which follows the
 * selection either way, so opening the panel shows the current pick at once.
 *
 * Two flags, the shell's arrangement (`context-panel-state.ts`): from 1280px the panel docks and its
 * open state is the viewer's remembered choice; below that it is a drawer over the canvas, asked for
 * each time and never remembered, because a drawer that reopened itself on every visit would be the
 * auto-open this replaced.
 *
 * Module-level, so per-PROCESS on the server: only the browser writes it, after hydration.
 */

// #region State
/** The docked panel stands open (from 1280px). Remembered; closed until the person opens it. */
export const detailsDocked = signal(false);

/** The details drawer is open (below 1280px). Never remembered. */
export const detailsSheetOpen = signal(false);
// #endregion

// #region Writes
/** Re-apply the remembered docked choice. Called once the panel's owner hydrates. */
export function restoreDetailsPanel(): void {
	const raw = readStored("local", LocalKeys.FILES_DETAILS_OPEN);
	if (raw === "0" || raw === "1") detailsDocked.value = raw === "1";
}

/** Open or close the docked panel, and remember it. */
export function setDetailsDocked(open: boolean): void {
	detailsDocked.value = open;
	writeStored("local", LocalKeys.FILES_DETAILS_OPEN, open ? "1" : "0");
}

/** Toggle the panel in whichever form the viewport presents it. */
export function toggleDetailsPanel(): void {
	if (contextPanelInflow()) setDetailsDocked(!detailsDocked.peek());
	else detailsSheetOpen.value = !detailsSheetOpen.peek();
}

/** Close the panel in whichever form the viewport presents it (its Close, a drag shut, Escape). */
export function closeDetailsPanel(): void {
	if (contextPanelInflow()) {
		if (detailsDocked.peek()) setDetailsDocked(false);
	} else detailsSheetOpen.value = false;
}

/** Whether the panel is showing in the form `inflow` names. */
export function detailsShown(inflow: boolean): boolean {
	return inflow ? detailsDocked.value : detailsSheetOpen.value;
}
// #endregion
