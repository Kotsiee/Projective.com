/**
 * storage-keys.ts — the single registry of every client-side storage key the web app writes or
 * reads. Nothing in the app should hand-write a `sessionStorage`/`localStorage`/cookie/cache key
 * literal: import the relevant dictionary here instead, so keys never drift, never silently collide,
 * and are discoverable in one place (the recurring "what did we call that key again?" tax).
 *
 * Conventions:
 *  - Every key is namespaced under the `pj` prefix so we never clash with third-party libraries
 *    sharing the same origin (Supabase GoTrue's own `sb-*` cookies, analytics, etc.).
 *  - Storage-web keys use dotted segments (`pj.session.redirectPath`); cookies use `pj_snake_case`
 *    (dots/spaces are awkward in `Set-Cookie`).
 *  - Values are frozen (`as const`) so the union of literal key strings is available to the type
 *    system and a typo is a compile error, not a silent miss.
 *
 * SSOT note: server-set auth cookies (session/refresh) are ultimately owned by Supabase GoTrue and
 * the `(dashboard)` middleware; the entries below document the app-owned names we read alongside
 * them — see `SYSTEM_ARCHITECTURE.md` §Authentication.
 */

// #region Session storage (cleared when the tab closes — transient, per-flow state)
/**
 * `window.sessionStorage` keys. Use for state that must survive a same-tab reload or an OAuth/SSO
 * round-trip but should NOT outlive the tab (return paths, in-progress onboarding, verify timers).
 */
export const SessionKeys = {
	/** The sanitised post-auth return path, persisted so an OAuth/SSO round-trip can restore it. */
	REDIRECT_PATH: "pj.session.redirectPath",
	/** Email awaiting confirmation, so `/verify` can render + poll it after a hard reload. */
	PENDING_VERIFICATION_EMAIL: "pj.session.pendingVerificationEmail",
	/** Epoch-ms deadline of the `/verify` (and reset) resend cooldown — survives a page refresh. */
	VERIFY_RESEND_DEADLINE: "pj.session.verifyResendDeadline",
	/** The `/join` wizard's current step id — lets a refresh land the user back where they were. */
	ONBOARDING_STAGE: "pj.session.onboardingStage",
	/** Opaque anti-forgery value round-tripped through an OAuth/SSO `state` parameter. */
	OAUTH_STATE: "pj.session.oauthState",
	/** The last Explore search scope selected in-tab (restores the entity dropdown after a reload). */
	EXPLORE_LAST_SCOPE: "pj.session.explore.scope",
} as const;
// #endregion

// #region Local storage (persists across sessions — durable preferences & caches)
/**
 * `window.localStorage` keys. Use for durable, non-sensitive preferences. NEVER store credentials,
 * tokens, or PII here — those belong in `HttpOnly` cookies (see {@link CookieKeys}).
 */
export const LocalKeys = {
	/** Explicit theme preference (`light` | `dark` | `system`) — mirrors `org.user_preferences.theme`. */
	THEME_PREFERENCE: "pj.local.theme",
	/** Last email typed at sign-in when "Keep me signed in" was checked (convenience prefill only). */
	REMEMBER_EMAIL: "pj.local.rememberEmail",
	/** The last active profile/context handle, so the app can rehydrate the switcher instantly. */
	LAST_ACTIVE_CONTEXT: "pj.local.lastActiveContext",
	/** Durable cache of onboarding progress metadata (see {@link CacheKeys.ONBOARDING_STAGE_CACHE}). */
	ONBOARDING_STAGE_CACHE: "pj.local.onboardingStageCache",
	/** Recent Explore search terms (most-recent-first, capped) — powers the search recall list. */
	EXPLORE_RECENT_SEARCHES: "pj.local.explore.recentSearches",
	/** Preferred Explore results layout (grid | list) — remembered across sessions. */
	EXPLORE_LAYOUT: "pj.local.explore.layout",
	/** Preferred Explore results sort key — remembered across sessions. */
	EXPLORE_SORT: "pj.local.explore.sort",
	/**
	 * Desktop global-sidebar collapsed vs expanded rail preference (`"1"` collapsed | `"0"` expanded).
	 * Read pre-paint in `_app.tsx` to set `data-sidebar` before first paint (no flash-of-wrong-width).
	 */
	SIDEBAR_COLLAPSED: "pj.local.shell.sidebarCollapsed",
	/** Persisted middle-nav (Blue lane) drag width in px — restored by the MiddleNavSplitter island. */
	MIDDLE_LANE_WIDTH: "pj.local.shell.laneWidth",
	/**
	 * The `/projects` feed's applied filter state, partitioned BY context id. Stored as a single JSON
	 * map (`Record<contextId, ProjectFeedParams>`) under this one key — the `StorageKey` union is
	 * closed, so we can't synthesise a per-context key literal; the partition lives inside the value.
	 * Lets each workspace reload exactly the filters the actor last left it on (the Continuity rule).
	 */
	PROJECTS_FILTERS: "pj.local.projects.filters",
} as const;
// #endregion

// #region Cookies (some HttpOnly + server-owned — documented here for the whole team)
/**
 * Cookie names. The auth-session/refresh cookies are `HttpOnly` and written server-side (GoTrue +
 * `(dashboard)` middleware); they are unreadable from JS by design and listed here for reference and
 * for the server helpers that set/clear them. CSRF + active-context are app-owned.
 */
export const CookieKeys = {
	/** App session token cookie (HttpOnly, server-set). Do not attempt to read from the client. */
	AUTH_SESSION_TOKEN: "pj_auth_session",
	/** App refresh token cookie (HttpOnly, server-set). */
	AUTH_REFRESH_TOKEN: "pj_auth_refresh",
	/** Double-submit CSRF token (readable, paired with a server-checked header). */
	CSRF_TOKEN: "pj_csrf",
	/** The acting profile/context id for the current dashboard session. */
	ACTIVE_CONTEXT: "pj_active_context",
} as const;
// #endregion

// #region System caches (CacheStorage / IndexedDB store names)
/** Named `CacheStorage` buckets and IndexedDB store names. */
export const CacheKeys = {
	/** Offline-tolerant cache of the multi-step onboarding draft + stage. */
	ONBOARDING_STAGE_CACHE: "pj-cache-onboarding-stage",
	/** Cached avatar/asset blobs keyed by file id. */
	ASSET_CACHE: "pj-cache-assets",
} as const;
// #endregion

/** Union of every known key literal — handy for exhaustive audits/telemetry. */
export type StorageKey =
	| (typeof SessionKeys)[keyof typeof SessionKeys]
	| (typeof LocalKeys)[keyof typeof LocalKeys]
	| (typeof CookieKeys)[keyof typeof CookieKeys]
	| (typeof CacheKeys)[keyof typeof CacheKeys];

// #region SSR-safe accessors
/**
 * Read/write helpers that no-op safely when there is no DOM (server render / prerender). They keep
 * the `try/catch` for Safari private-mode + storage-disabled once, here, rather than at every call
 * site. Prefer these over touching `globalThis.sessionStorage` directly.
 */
function store(kind: "session" | "local"): Storage | null {
	try {
		return kind === "session" ? globalThis.sessionStorage : globalThis.localStorage;
	} catch {
		return null;
	}
}

/** Read a stored string, or `null` if unset/unavailable. */
export function readStored(kind: "session" | "local", key: StorageKey): string | null {
	try {
		return store(kind)?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

/** Persist a string. Silently no-ops when storage is unavailable. */
export function writeStored(kind: "session" | "local", key: StorageKey, value: string): void {
	try {
		store(kind)?.setItem(key, value);
	} catch {
		// storage full / disabled — non-fatal, the feature degrades to in-memory only.
	}
}

/** Remove a stored key. */
export function removeStored(kind: "session" | "local", key: StorageKey): void {
	try {
		store(kind)?.removeItem(key);
	} catch {
		// no-op
	}
}
// #endregion
