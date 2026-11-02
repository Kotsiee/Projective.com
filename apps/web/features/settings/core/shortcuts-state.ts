/// <reference lib="dom" />
import type { ResolvedUiSettings, ToggleableShortcutId } from "@projective/types/org";
import { disabledShortcuts } from "@features/shortcuts/core/shortcut-registry.ts";
import { persistOverlaysOnDevice } from "./appearance-state.ts";
import { SettingsService } from "./SettingsService.ts";

/**
 * shortcuts-state — the keyboard half of `ui_settings` on THIS device (Decision #371), on the
 * appearance model: a change paints `<html data-tooltip-shortcuts>` / `data-shortcuts-off` at once,
 * so every tooltip and listener obeys it with no reload, then writes the `pj.a11y` cookie the server
 * paints the next page from, then the account.
 */

/** The keyboard prefs this device is painted with right now. */
export function currentShortcutPrefs(): ResolvedUiSettings {
	return {
		show_tooltip_shortcuts: document.documentElement.dataset.tooltipShortcuts === "on",
		disabled_shortcuts: disabledShortcuts() as ToggleableShortcutId[],
	};
}

/** Paint `next` onto the document and store it as this device's copy. */
export function paintShortcutPrefs(next: ResolvedUiSettings): void {
	const root = document.documentElement.dataset;
	if (next.show_tooltip_shortcuts) root.tooltipShortcuts = "on";
	else delete root.tooltipShortcuts;
	if (next.disabled_shortcuts.length) root.shortcutsOff = next.disabled_shortcuts.join(" ");
	else delete root.shortcutsOff;
	persistOverlaysOnDevice({ tips: next.show_tooltip_shortcuts, keysOff: next.disabled_shortcuts });
}

/** How a commit ended — the section's status line reads this. */
export type ShortcutsSaved = "account" | "device" | "failed";

/** Apply on this device, then save to the account; repaints if the account answers differently. */
export async function commitShortcutPrefs(
	next: ResolvedUiSettings,
): Promise<{ saved: ShortcutsSaved; prefs: ResolvedUiSettings; message?: string }> {
	paintShortcutPrefs(next);
	const res = await SettingsService.savePreferences({ uiSettings: next });
	if (!res.ok) return { saved: "failed", prefs: next, message: res.message };
	const stored = res.data.uiSettings ?? next;
	if (JSON.stringify(stored) !== JSON.stringify(next)) paintShortcutPrefs(stored);
	return { saved: res.data.uiSettingsPersisted ? "account" : "device", prefs: stored };
}
