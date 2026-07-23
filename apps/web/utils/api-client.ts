/**
 * api-client.ts — the shared client-side fetch wrapper with silent session recovery.
 *
 * The thin-frontend rule keeps islands dumb: they call a feature `*Service` → a feature `api.ts`
 * transport → an internal `/api/*` route. This wrapper is the ONE place that transport layer routes a
 * `401 Unauthorized` (an expired access token) through recovery instead of surfacing a logout:
 *
 *   1. On a 401, POST once to `/api/auth/refresh`, which renews the HttpOnly session cookies from the
 *      long-lived refresh token.
 *   2. If the refresh succeeds, retry the original request seamlessly (the browser now carries the
 *      fresh `sb-*` cookies) — the UI never sees the blip.
 *   3. If the refresh fails (the session is truly gone), redirect to `/login`, preserving the current
 *      location as `redirectTo` so the user returns exactly where they were after signing back in.
 *
 * Concurrent 401s share a single in-flight refresh (no stampede). Only pass re-sendable requests
 * (string/undefined bodies — every feature `api.ts` helper JSON-stringifies its body, so this holds).
 * Adopt it in a feature's `api.ts` by swapping `fetch(...)` for `apiFetch(...)` — see
 * `features/projects/core/api.ts`.
 */

/** A single shared refresh promise so N concurrent 401s trigger exactly one `/api/auth/refresh`. */
let refreshInFlight: Promise<boolean> | null = null;

/** Renew the session cookies. Resolves `true` when the refresh endpoint re-issued a session. */
function refreshSession(): Promise<boolean> {
	if (!refreshInFlight) {
		refreshInFlight = fetch("/api/auth/refresh", {
			method: "POST",
			headers: { accept: "application/json" },
		})
			.then((res) => res.ok)
			.catch(() => false)
			.finally(() => {
				refreshInFlight = null;
			});
	}
	return refreshInFlight;
}

/** Navigate to sign-in, threading the current path (+ query) back as the loss-free return target. */
function redirectToLogin(): void {
	if (typeof globalThis.location === "undefined") return;
	const here = globalThis.location.pathname + globalThis.location.search;
	globalThis.location.href = `/login?redirectTo=${encodeURIComponent(here)}`;
}

/**
 * `fetch` with transparent 401 → refresh → retry recovery. A non-401 response (success or any other
 * error) passes straight through untouched. On an unrecoverable 401 it redirects to `/login` and
 * returns the original 401 response so the caller's soft error-handling still resolves.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(input, init);
	if (res.status !== 401) return res;

	const recovered = await refreshSession();
	if (recovered) {
		const retry = await fetch(input, init);
		if (retry.status !== 401) return retry;
	}

	// Still unauthorized after a refresh attempt → the session is genuinely gone.
	redirectToLogin();
	return res;
}
