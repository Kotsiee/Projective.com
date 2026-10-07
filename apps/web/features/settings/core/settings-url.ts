import { isSettingsSectionKey, type SettingsSectionKey } from "@projective/types/settings";

/**
 * settings-url — the `?settings=<section>` deep-link contract of the contextual Settings modal
 * (Decision #150). Pure: the host island owns the history writes; this only reads and rewrites a
 * `pathname + search + hash` string.
 *
 * - The FIRST open pushes an entry (so browser Back dismisses the modal); moving between sections
 *   inside the modal replaces it; closing removes the parameter and nothing else.
 * - Every other parameter and the hash survive in their original order, so the modal coexists with a
 *   page's own filters, a `?tkv=` ticket link, or a wallet's `?w=`.
 */

/** The query-string key. */
export const SETTINGS_PARAM = "settings";

/**
 * The raw `settings` value, or `null` when absent or empty. A malformed value is returned rather than
 * dropped — the host must learn it was there to strip it from the address bar.
 */
export function readSettingsParam(search: string): string | null {
	const value = new URLSearchParams(search).get(SETTINGS_PARAM);
	return value === null || value.length === 0 ? null : value;
}

/** The section a `settings` value addresses, or `null` when it names none. */
export function settingsParamSection(search: string): SettingsSectionKey | null {
	const value = readSettingsParam(search);
	return value !== null && isSettingsSectionKey(value) ? value : null;
}

/**
 * `href` with the `settings` parameter set to `section`, or removed when `null`. Every other
 * parameter is preserved verbatim and in order, as is the hash. Idempotent, so a sync that runs on
 * every change can compare before it touches history.
 */
export function withSettingsParam(href: string, section: SettingsSectionKey | null): string {
	const hashAt = href.indexOf("#");
	const hash = hashAt >= 0 ? href.slice(hashAt) : "";
	const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
	const queryAt = beforeHash.indexOf("?");
	const pathname = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
	const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : "");
	if (section === null) params.delete(SETTINGS_PARAM);
	else params.set(SETTINGS_PARAM, section);
	const search = params.toString();
	return `${pathname}${search ? `?${search}` : ""}${hash}`;
}

/**
 * Whether the contextual modal may open over a page. The console itself never hosts it — a
 * `?settings=` there is a request to show that section's PAGE — and the auth screens have no shell.
 */
export function settingsModalAllowed(pathname: string): boolean {
	if (pathname === "/settings" || pathname.startsWith("/settings/")) return false;
	return !["/login", "/join", "/verify", "/forgot-password"].some((p) =>
		pathname === p || pathname.startsWith(`${p}/`)
	);
}
