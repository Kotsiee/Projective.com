import {
	type AppearancePreferences,
	ContrastPreference,
	CvdPreference,
	DEFAULT_APPEARANCE,
	FontPreference,
	LayoutDirection,
	localeDirection,
	MotionPreference,
} from "@projective/types/org";

/**
 * a11y-context — the `pj.a11y` cookie: the per-device mirror of a viewer's accessibility overlays
 * (contrast · font · colour vision · motion), and the one thing server rendering reads to paint them
 * in the FIRST byte (root CLAUDE.md §8 Decision #150).
 *
 * The durable copy is `org.user_preferences`; the cookie is what makes it visible before hydration.
 * Without it the page would paint in the defaults and snap into high contrast or OpenDyslexic a
 * moment later — a flash of the wrong accessibility state is not cosmetic for the people who need
 * the overlay. The theme CHOICE is deliberately not in here: it already has its own pre-paint path
 * (`localStorage["theme"]` read by `_app.tsx`'s inline script), and two sources for one value is how
 * they come to disagree.
 *
 * Pure and isomorphic: the server parses it in `_middleware.ts`, the browser writes it from
 * `features/settings/core/appearance-state.ts`, and the PATCH route sets it in its response headers.
 */

// #region Codec
/** The cookie the server reads. Not HttpOnly — it carries no authority, only presentation. */
export const A11Y_COOKIE = "pj.a11y";

/** One year, in seconds. */
export const A11Y_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * What the cookie carries: the overlay half of {@link AppearancePreferences}, plus the document
 * direction (`org.user_preferences.layout_direction`) — the one display preference that also has to be
 * right before first paint, since a page laid out left-to-right and then mirrored is a full reflow.
 */
export type A11yOverlays = Pick<AppearancePreferences, "contrast" | "font" | "cvd" | "motion"> & {
	dir: LayoutDirection;
};

/** No overlay at all — the OS media queries still apply on top of this. */
export const DEFAULT_A11Y: A11yOverlays = {
	contrast: DEFAULT_APPEARANCE.contrast,
	font: DEFAULT_APPEARANCE.font,
	cvd: DEFAULT_APPEARANCE.cvd,
	motion: DEFAULT_APPEARANCE.motion,
	dir: "auto",
};

/**
 * Serialise overlays as `contrast-high_font-sans_cvd-none_motion-standard` — readable in devtools,
 * and built only from characters RFC 6265 allows unquoted in a cookie value (no `,`, `;` or space).
 */
export function serializeA11y(overlays: A11yOverlays): string {
	return `contrast-${overlays.contrast}_font-${overlays.font}_cvd-${overlays.cvd}_motion-${overlays.motion}_dir-${overlays.dir}`;
}

/**
 * Parse a cookie value back into overlays. Total: a missing, truncated or tampered value yields the
 * defaults field by field, never a throw — an unreadable preference must degrade to "no overlay",
 * not to a broken page.
 */
export function parseA11y(raw: string | null | undefined): A11yOverlays {
	const out: A11yOverlays = { ...DEFAULT_A11Y };
	if (!raw) return out;
	let value = raw;
	try {
		value = decodeURIComponent(raw);
	} catch {
		/* a malformed escape — read what is there */
	}
	for (const pair of value.split("_")) {
		const dash = pair.indexOf("-");
		if (dash <= 0) continue;
		const key = pair.slice(0, dash);
		const v = pair.slice(dash + 1);
		if (key === "contrast" && ContrastPreference.safeParse(v).success) {
			out.contrast = v as A11yOverlays["contrast"];
		}
		if (key === "font" && FontPreference.safeParse(v).success) out.font = v as A11yOverlays["font"];
		if (key === "cvd" && CvdPreference.safeParse(v).success) out.cvd = v as A11yOverlays["cvd"];
		if (key === "motion" && MotionPreference.safeParse(v).success) {
			out.motion = v as A11yOverlays["motion"];
		}
		if (key === "dir" && LayoutDirection.safeParse(v).success) out.dir = v as A11yOverlays["dir"];
	}
	return out;
}

/** The `Set-Cookie` header value that stores `overlays` for a year. */
export function a11ySetCookie(overlays: A11yOverlays): string {
	return `${A11Y_COOKIE}=${
		serializeA11y(overlays)
	}; Path=/; Max-Age=${A11Y_COOKIE_MAX_AGE}; SameSite=Lax`;
}
// #endregion

// #region Root attributes
/**
 * The `<html>` data attributes for a set of overlays — ONLY the overlays that are on. A `standard`
 * contrast or motion writes nothing, so the stylesheet's `prefers-contrast` / `prefers-reduced-motion`
 * blocks still answer the reader's OS; writing an explicit "normal" here would switch them off.
 *
 * An `auto` direction is resolved by the viewer's `locale` (its script): a right-to-left language
 * lays the page out right to left from the first byte; a left-to-right one writes nothing.
 */
export function a11yRootAttributes(
	overlays: A11yOverlays,
	locale?: string,
): Record<string, string> {
	const attrs: Record<string, string> = {};
	if (overlays.contrast === "high") attrs["data-contrast"] = "high";
	if (overlays.font === "dyslexic") attrs["data-font"] = "dyslexic";
	if (overlays.cvd !== "none") attrs["data-cvd"] = overlays.cvd;
	if (overlays.motion === "reduced") attrs["data-motion"] = "reduced";
	if (overlays.dir === "ltr" || overlays.dir === "rtl") attrs.dir = overlays.dir;
	else if (locale && localeDirection(locale) === "rtl") attrs.dir = "rtl";
	return attrs;
}

/** Read the overlays a request carries, from its `Cookie` header. */
export function resolveA11yContext(req: Request): A11yOverlays {
	const header = req.headers.get("cookie") ?? "";
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() === A11Y_COOKIE) return parseA11y(part.slice(eq + 1).trim());
	}
	return { ...DEFAULT_A11Y };
}
// #endregion
