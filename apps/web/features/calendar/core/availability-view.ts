import { isSlug } from "@projective/types/slugs";

/**
 * availability-view — the `/calendar` address for its two modes. `?view=availability` turns the hub
 * from the agenda into the full-page availability manager, and `?preset=<avp- slug>` names the
 * template open in it, so the server renders the right lane, bands and body in the first byte and a
 * reload, a shared link or Back lands on the same template. Anything else reads as the agenda, and an
 * unknown slug as the default template.
 */

/** Which of the hub's two pages a URL addresses. */
export type CalendarMode = "agenda" | "availability";

export const VIEW_PARAM = "view";
export const PRESET_PARAM = "preset";

/** The mode a `/calendar` URL addresses. */
export function calendarModeOf(url: URL): CalendarMode {
	return url.searchParams.get(VIEW_PARAM) === "availability" ? "availability" : "agenda";
}

/** The template slug a URL names, when it is shaped like one. */
export function presetSlugOf(url: URL): string | null {
	const slug = url.searchParams.get(PRESET_PARAM);
	return slug && isSlug(slug, "preset") ? slug : null;
}

/** The address of a mode, and in the availability mode optionally of one template. */
export function calendarModeHref(mode: CalendarMode, presetSlug?: string | null): string {
	if (mode === "agenda") return "/calendar";
	const query = new URLSearchParams({ [VIEW_PARAM]: "availability" });
	if (presetSlug) query.set(PRESET_PARAM, presetSlug);
	return `/calendar?${query}`;
}
