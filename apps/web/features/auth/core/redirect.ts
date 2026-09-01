/**
 * Post-authentication return-path handling.
 *
 * The destination a user was on before entering the auth flow is carried through as a `redirectTo`
 * query parameter. It is **untrusted input** (it can arrive from the auth-guard bounce, an OAuth
 * round-trip, or a hand-crafted link), so every consumer routes it through {@link safeRedirect}
 * before using it — this prevents open-redirect / `javascript:` / protocol-relative attacks by
 * only ever honouring a same-origin absolute path.
 *
 * A return path is always a **post-auth destination**, never a step of the auth flow itself. So an
 * auth route arriving in that slot is rejected the same way a hostile origin is: honouring it sends
 * a freshly-signed-in user straight back to `/login` or `/join`, which is the redirect loop this
 * module exists to prevent.
 */

/** Where users land after auth when no explicit return path was captured. */
export const DEFAULT_REDIRECT = "/home";

/** Query keys we accept a return path under (`redirectTo` canonical; `redirect` = guard legacy). */
const REDIRECT_KEYS = ["redirectTo", "redirect"] as const;

/**
 * Route prefixes that belong to the auth flow itself and can therefore never be a post-auth
 * destination. `/api/auth/*` is included because an API endpoint is not a page a browser should land
 * on, and the OAuth entry point would otherwise be a self-referential loop.
 */
const AUTH_PATHS = [
	"/login",
	"/join",
	"/register",
	"/verify",
	"/forgot-password",
	"/reset",
	"/logout",
	"/api/auth",
] as const;

/** True if the string contains any C0 control character or DEL — never valid in a redirect path. */
function hasControlChar(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

/**
 * True when a path is a step of the auth flow (matching the whole segment, so `/joined` and
 * `/logins` are ordinary app routes and are not swept up by a prefix test).
 */
export function isAuthPath(path: string): boolean {
	const pathname = path.split(/[?#]/)[0].toLowerCase().replace(/\/+$/, "") || "/";
	return AUTH_PATHS.some((auth) => pathname === auth || pathname.startsWith(`${auth}/`));
}

/**
 * Normalise an untrusted return path to a safe same-origin path, or fall back.
 *
 * Accepts only a string beginning with a single `/` (an in-app path). Rejects protocol-relative
 * (`//evil.com`), backslash tricks, absolute URLs, control characters, and any auth route (which
 * would bounce the user back into the flow they just completed). A fallback that is itself an auth
 * route degrades to {@link DEFAULT_REDIRECT} rather than being trusted by virtue of its position.
 */
export function safeRedirect(
	raw: string | null | undefined,
	fallback: string = DEFAULT_REDIRECT,
): string {
	const safeFallback = isSafePath(fallback) ? fallback : DEFAULT_REDIRECT;
	return isSafePath(raw) ? raw : safeFallback;
}

/** The predicate behind {@link safeRedirect} — narrows to a usable in-app destination. */
function isSafePath(raw: string | null | undefined): raw is string {
	if (typeof raw !== "string" || raw.length === 0) return false;
	if (raw[0] !== "/") return false; // must be an in-app path
	if (raw.startsWith("//") || raw.startsWith("/\\")) return false; // protocol-relative
	if (hasControlChar(raw)) return false;
	if (isAuthPath(raw)) return false; // never land back inside the auth flow
	return true;
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
