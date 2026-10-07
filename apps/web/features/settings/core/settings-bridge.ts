import type { SettingsSectionKey } from "@projective/types/settings";
import { settingsHref } from "./settings-registry.ts";

/**
 * settings-bridge — the one way any surface opens Settings (Decision #150): `openSettings("messaging")`.
 *
 * A window event, not an import of the host: a gear in the inbox, the calendar or the wallet must not
 * pull the whole modal into its island's bundle, and the host must not know who its callers are. The
 * event is CANCELABLE — the mounted {@link SettingsModalHost} claims it with `preventDefault()`. When
 * nothing claims it (no host on this page: a guest shell, the console itself, a route the modal does
 * not open over) the bridge falls back to navigating to the section's console page, so a gear always
 * does something.
 */

/** The event name. */
export const SETTINGS_OPEN_EVENT = "pj:settings-open";

/** What an open request carries. */
export interface SettingsOpenDetail {
	section: SettingsSectionKey;
	/** A registry anchor to scroll to inside the section. */
	anchor?: string | null;
}

/**
 * Open a Settings section — in the contextual modal where one is mounted, else on its console page.
 * Returns whether the modal took it.
 */
export function openSettings(section: SettingsSectionKey, anchor?: string | null): boolean {
	const target = globalThis as typeof globalThis & { dispatchEvent?: (event: Event) => boolean };
	let claimed = false;
	try {
		const event = new CustomEvent<SettingsOpenDetail>(SETTINGS_OPEN_EVENT, {
			detail: { section, anchor: anchor ?? null },
			cancelable: true,
		});
		claimed = target.dispatchEvent?.(event) === false;
	} catch {
		claimed = false;
	}
	if (!claimed) globalThis.location?.assign(settingsHref(section, anchor));
	return claimed;
}

/**
 * On the console, the lane and the page body are two islands: the lane asks the page to bring an
 * anchor into view — and, after Enter in the search, to move focus into it — with this event.
 */
export const SETTINGS_FOCUS_EVENT = "pj:settings-focus";

/** What a focus request carries. */
export interface SettingsFocusDetail {
	anchor: string | null;
	focus: boolean;
}

/** Ask the console page to show `anchor` (and optionally focus into it). */
export function requestSettingsFocus(anchor: string | null, focus: boolean): void {
	try {
		globalThis.dispatchEvent(
			new CustomEvent<SettingsFocusDetail>(SETTINGS_FOCUS_EVENT, { detail: { anchor, focus } }),
		);
	} catch {
		/* no window — non-fatal */
	}
}

/**
 * Subscribe to open requests. The listener returns `true` to CLAIM one (the bridge then does not
 * navigate). Returns an unsubscribe.
 */
export function onOpenSettings(listener: (detail: SettingsOpenDetail) => boolean): () => void {
	const handle = (event: Event) => {
		const detail = (event as CustomEvent<SettingsOpenDetail>).detail;
		if (detail && listener(detail)) event.preventDefault();
	};
	globalThis.addEventListener(SETTINGS_OPEN_EVENT, handle);
	return () => globalThis.removeEventListener(SETTINGS_OPEN_EVENT, handle);
}
