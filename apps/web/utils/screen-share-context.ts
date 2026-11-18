import { SCREEN_SHARE_ACTIVE, SCREEN_SHARE_ATTRIBUTE } from "@projective/ui/utils/screen-share";

/**
 * screen-share-context — the `pj.screen_share` cookie: the per-device mirror of screen sharing mode
 * (Decision #297, SYSTEM_ARCHITECTURE §State Hydration → Screen sharing mode).
 *
 * The durable copy is `localStorage` (`LocalKeys.SCREEN_SHARE`); the cookie is what lets the server
 * mask the first byte. It is non-authoritative: it can only remove output, never widen access, and
 * no service or `/api/*` route reads it. Pure and isomorphic: the server parses it in
 * `_middleware.ts`, and the `ScreenShareBridge` island writes it. The request-scoped SSR state lives
 * in `screen-share-scope.ts`, which is server-only.
 */

// #region Codec
/** The cookie the server reads. Not HttpOnly — it carries no authority, only presentation. */
export const SCREEN_SHARE_COOKIE = "pj.screen_share";

/** One year, in seconds. */
export const SCREEN_SHARE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The one value that means "on". Anything else, malformed or missing, means off. */
export const SCREEN_SHARE_COOKIE_ON = "1";

/** Whether a cookie value turns the mode on: exactly `"1"`. */
export function parseScreenShare(raw: string | null | undefined): boolean {
	return raw === SCREEN_SHARE_COOKIE_ON;
}

/**
 * The `document.cookie` string that stores the mode (`on`) or deletes the cookie. `Secure` follows
 * the scheme, as Decision #201's builders do (`location.protocol === "https:"` in the browser).
 */
export function screenShareCookie(on: boolean, secure: boolean): string {
	const value = on
		? `${SCREEN_SHARE_COOKIE}=${SCREEN_SHARE_COOKIE_ON}; path=/; max-age=${SCREEN_SHARE_COOKIE_MAX_AGE}`
		: `${SCREEN_SHARE_COOKIE}=; path=/; max-age=0`;
	return `${value}; samesite=lax${secure ? "; secure" : ""}`;
}

/** Read the mode a request carries, from its `Cookie` header. A header read with no I/O. */
export function resolveScreenShare(req: Request): boolean {
	const header = req.headers.get("cookie") ?? "";
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() === SCREEN_SHARE_COOKIE) {
			return parseScreenShare(part.slice(eq + 1).trim());
		}
	}
	return false;
}
// #endregion

// #region Root attribute
/** The `<html>` attribute for the mode: present only when on. */
export function screenShareRootAttributes(active: boolean): Record<string, string> {
	return active ? { [SCREEN_SHARE_ATTRIBUTE]: SCREEN_SHARE_ACTIVE } : {};
}

/**
 * The pre-paint restorer `_app.tsx` inlines in `<head>`. With the cookie exactly `1` it paints the
 * attribute (a no-op after SSR, a guard for a shell document the service worker served). With no
 * cookie but the `localStorage` copy at `"1"` it paints the attribute and re-writes the cookie, so
 * the next request is server-masked again. It never removes the attribute.
 *
 * Its literals MUST match `LocalKeys.SCREEN_SHARE` and {@link screenShareCookie}; the unit test
 * runs it against a fake document to pin both.
 */
export const SCREEN_SHARE_PREPAINT_SCRIPT =
	`(()=>{try{const d=document.documentElement,k="pj.screen_share=",c=document.cookie.split(";").map((p)=>p.trim()).find((p)=>p.indexOf(k)===0);if(c!==undefined){if(c===k+"1")d.setAttribute("data-screen-share","active");return;}if(localStorage.getItem("pj.local.screenShare")!=="1")return;d.setAttribute("data-screen-share","active");document.cookie="pj.screen_share=1; path=/; max-age=31536000; samesite=lax"+(location.protocol==="https:"?"; secure":"");}catch(_){/* noop */}})();`;
// #endregion
