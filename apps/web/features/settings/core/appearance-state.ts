import { dsConfig, setThemePreference, themePreference, updateConfig } from "@projective/ui/system";
import type { AppearancePreferences } from "@projective/types/org";
import type { LayoutDirection } from "@projective/types/org";
import {
	A11Y_COOKIE,
	A11Y_COOKIE_MAX_AGE,
	type A11yOverlays,
	parseA11y,
	serializeA11y,
} from "@web/utils/a11y-context.ts";
import { LocalKeys, writeStored } from "@web/utils/storage-keys.ts";
import { type SettingsResult, SettingsService } from "./SettingsService.ts";

/**
 * appearance-state — the client half of Settings → Appearance (Decision #150): what a change does on
 * THIS device the instant it is made, and how it reaches the account.
 *
 * Order matters and is fixed: (1) the design-system store, so the page repaints in the same frame;
 * (2) the `pj.a11y` cookie, so the next server render paints it; (3) the localStorage copy, so a
 * cleared cookie is restored before paint; (4) `PATCH /api/user/preferences`, the durable account
 * copy. The first three cannot fail in a way the person would notice; only the fourth can, and its
 * failure leaves the device in the state they chose and says "saved on this device".
 */

// #region Reading
/** The appearance this device is painted with right now. */
export function currentAppearance(): AppearancePreferences {
	const cfg = dsConfig.value;
	return {
		theme: themePreference.value,
		contrast: cfg.highContrast ? "high" : "standard",
		font: cfg.dyslexicFont ? "dyslexic" : "sans",
		cvd: cfg.cvd,
		motion: cfg.reducedMotion ? "reduced" : "standard",
	};
}
// #endregion

// #region Device writes
/** Repaint the document in `next` — the store, which `bindRootTheme` writes onto `:root`. */
export function paintAppearance(next: AppearancePreferences): void {
	if (next.theme !== themePreference.peek()) setThemePreference(next.theme);
	updateConfig({
		highContrast: next.contrast === "high",
		dyslexicFont: next.font === "dyslexic",
		cvd: next.cvd,
		reducedMotion: next.motion === "reduced",
	});
}

/** The device copy as it stands — the cookie, which the server paints from. */
function deviceCopy(): A11yOverlays {
	if (typeof document === "undefined") return parseA11y(null);
	const entry = document.cookie.split("; ").find((part) => part.startsWith(`${A11Y_COOKIE}=`));
	return parseA11y(entry ? entry.slice(A11Y_COOKIE.length + 1) : null);
}

/**
 * Write the per-device copies — the cookie the server reads and the localStorage fallback — merging
 * `next` over what the device already holds, so an appearance change never drops the direction and a
 * direction change never drops an overlay.
 */
export function persistOverlaysOnDevice(next: Partial<A11yOverlays>): void {
	const current = deviceCopy();
	const overlays: A11yOverlays = {
		contrast: next.contrast ?? current.contrast,
		font: next.font ?? current.font,
		cvd: next.cvd ?? current.cvd,
		motion: next.motion ?? current.motion,
		dir: next.dir ?? current.dir,
	};
	writeStored("local", LocalKeys.A11Y_PREFERENCES, JSON.stringify(overlays));
	if (typeof document === "undefined") return;
	document.cookie = `${A11Y_COOKIE}=${
		serializeA11y(overlays)
	}; path=/; max-age=${A11Y_COOKIE_MAX_AGE}; samesite=lax`;
}
// #endregion

// #region Commit
/** How a commit ended — the section's status line reads this. */
export type AppearanceSaved = "account" | "device" | "failed";

/**
 * Apply a change everywhere, in the order above, and reconcile with what the account stored. Returns
 * where it landed; on a reconciliation that disagrees (another device changed it meanwhile), the
 * server's answer is painted.
 */
export async function commitAppearance(
	patch: Partial<AppearancePreferences>,
): Promise<{ saved: AppearanceSaved; appearance: AppearancePreferences; message?: string }> {
	const next = { ...currentAppearance(), ...patch };
	paintAppearance(next);
	persistOverlaysOnDevice(next);
	const res: SettingsResult<
		{ appearance: AppearancePreferences | null; appearancePersisted: boolean }
	> = await SettingsService.savePreferences(patch);
	if (!res.ok) return { saved: "failed", appearance: next, message: res.message };
	const stored = res.data.appearance ?? next;
	if (JSON.stringify(stored) !== JSON.stringify(next)) {
		paintAppearance(stored);
		persistOverlaysOnDevice(stored);
	}
	return { saved: res.data.appearancePersisted ? "account" : "device", appearance: stored };
}
// #endregion

// #region Direction
/**
 * Apply a document direction on this device at once and remember it in the device copy, so the next
 * server render lays the page out the same way (`<html dir>` from the cookie). `auto` removes the
 * attribute: the document follows its language's natural direction.
 */
export function applyDirection(dir: LayoutDirection): void {
	if (typeof document !== "undefined") {
		if (dir === "auto") document.documentElement.removeAttribute("dir");
		else document.documentElement.dir = dir;
	}
	persistOverlaysOnDevice({ dir });
}
// #endregion
