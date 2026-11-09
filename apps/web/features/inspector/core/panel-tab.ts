import { signal } from "@preact/signals";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";

/**
 * panel-tab — which tab the inspector's side panel shows: the canvas's controls, the file's facts, or
 * on `/inspect` who has access to it (Decision #402). One choice for the standalone page and the
 * preview modal alike, remembered in this browser, so the next file opens on the tab the person last
 * chose; the modal, which has no Access tab, shows View for it.
 */

/** The tabs of the inspector's side panel. */
export type PanelTab = "view" | "details" | "access";

/** One tab of a panel's strip. */
export interface PanelTabItem {
	key: PanelTab;
	label: string;
}

/** The preview modal's tabs in order: the canvas's controls, then the file's facts. */
export const PANEL_TABS: readonly PanelTabItem[] = [
	{ key: "view", label: "View" },
	{ key: "details", label: "Details" },
];

/** The standalone page's tabs: the modal's, then who has access. */
export const INSPECT_PANEL_TABS: readonly PanelTabItem[] = [
	...PANEL_TABS,
	{ key: "access", label: "Access" },
];

/** The tab a stored value names; anything else is View, the first tab. */
export function parsePanelTab(raw: string | null): PanelTab {
	return raw === "details" || raw === "access" ? raw : "view";
}

/** The tab a strip of `tabs` shows for `tab`: the tab itself when the strip has it, else View. */
export function tabWithin(tab: PanelTab, tabs: readonly PanelTabItem[]): PanelTab {
	return tabs.some((item) => item.key === tab) ? tab : "view";
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
