/**
 * Post-authentication return-path handling.
 *
 * The destination a user was on before entering the auth flow is carried through as a `redirectTo`
 * query parameter. It is **untrusted input** (it can arrive from the auth-guard bounce, an OAuth
 * round-trip, or a hand-crafted link), so every consumer routes it through {@link safeRedirect}
 * before using it — this prevents open-redirect / `javascript:` / protocol-relative attacks by
 * only ever honouring a same-origin absolute path.
 */

/** Where users land after auth when no explicit return path was captured. */
export const DEFAULT_REDIRECT = "/home";

/** Query keys we accept a return path under (`redirectTo` canonical; `redirect` = guard legacy). */
const REDIRECT_KEYS = ["redirectTo", "redirect"] as const;

/** True if the string contains any C0 control character or DEL — never valid in a redirect path. */
function hasControlChar(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

/**
 * Normalise an untrusted return path to a safe same-origin path, or fall back.
 *
 * Accepts only a string beginning with a single `/` (an in-app path). Rejects protocol-relative
 * (`//evil.com`), backslash tricks, absolute URLs, and control characters.
 */
export function safeRedirect(
	raw: string | null | undefined,
	fallback: string = DEFAULT_REDIRECT,
): string {
	if (typeof raw !== "string" || raw.length === 0) return fallback;
	if (raw[0] !== "/") return fallback; // must be an in-app path
	if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback; // protocol-relative
	if (hasControlChar(raw)) return fallback;
	return raw;
}

/** Pull the return path out of a URL's search params (checking each accepted key), sanitised. */
export function readRedirect(params: URLSearchParams, fallback?: string): string {
	for (const key of REDIRECT_KEYS) {
		const value = params.get(key);
		if (value) return safeRedirect(value, fallback);
	}
	return safeRedirect(null, fallback);
}

/** Append a sanitised `redirectTo` to a base path — used to thread the return path between steps. */
export function withRedirect(path: string, redirectTo: string): string {
	const safe = safeRedirect(redirectTo);
	if (safe === DEFAULT_REDIRECT) return path;
	const sep = path.includes("?") ? "&" : "?";
	return `${path}${sep}redirectTo=${encodeURIComponent(safe)}`;
}
