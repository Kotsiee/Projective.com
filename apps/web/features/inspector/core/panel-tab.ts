import { signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * panel-tab — which tab the inspector's side panel shows: the canvas's controls or the file's facts.
 * One choice for the standalone page and the preview modal alike, remembered in this browser, so the
 * next file opens on the tab the person last chose.
 */

/** The two tabs of the inspector's side panel. */
export type PanelTab = "view" | "details";

/** The tabs in order: the canvas's controls, then the file's facts. */
export const PANEL_TABS: readonly { key: PanelTab; label: string }[] = [
	{ key: "view", label: "View" },
	{ key: "details", label: "Details" },
];

/** The tab a stored value names; anything else is View, the first tab. */
export function parsePanelTab(raw: string | null): PanelTab {
	return raw === "details" ? "details" : "view";
}

/** The tab showing now. View until {@link restorePanelTab} runs, so SSR and hydration agree. */
export const panelTab = signal<PanelTab>("view");

let restored = false;

/** Read the remembered tab, once per page, after hydration. */
export function restorePanelTab(): void {
	if (restored) return;
	restored = true;
	panelTab.value = parsePanelTab(readStored("local", LocalKeys.INSPECTOR_PANEL_TAB));
}

/** Show a tab and remember it. */
export function choosePanelTab(tab: PanelTab): void {
	panelTab.value = tab;
	writeStored("local", LocalKeys.INSPECTOR_PANEL_TAB, tab);
}
