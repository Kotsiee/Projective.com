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
	/**
	 * DEV-ONLY. The Developer-Tools Context Switcher's active persona/ownership/role overrides, as a
	 * JSON blob. Session-scoped (transient) on purpose: a reload should not leave a developer stuck
	 * simulating a fake persona. Read/written only by `apps/web/features/devtools/*`, which is excluded
	 * from production builds — the key is inert in production.
	 */
	DEV_CONTEXT_OVERRIDES: "pj.session.dev.contextOverrides",
	/**
	 * The active floating "Pop Out Chat" popover state (task §1) — a JSON blob
	 * `{ scope, projectId, channelId, title, href, x?, y? }`. Session-scoped so a popped-out
	 * conversation survives full-page navigations (the popover re-mounts from this and shows a "Return
	 * to Channel" button when the viewer has navigated away), but does NOT outlive the tab. Closing the
	 * popover clears it.
	 */
	CHAT_POPOUT: "pj.session.chatPopout",
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
	/**
	 * The account popover's chosen presence status (`online` | `away` | `dnd` | `invisible`). A
	 * client-side preference persisted across sessions until the live presence service owns it; read
	 * after hydration so it never diverges from the SSR-painted default.
	 */
	ACCOUNT_STATUS: "pj.local.account.status",
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
	 * Guest floating side-nav collapsed vs expanded preference (`"1"` collapsed | `"0"` expanded).
	 * The guest equivalent of {@link SIDEBAR_COLLAPSED}: read pre-paint in `_app.tsx` to set
	 * `:root[data-guest-nav]` before first paint (no flash-of-wrong-width), re-synced by the
	 * `GuestAside` island after hydration.
	 */
	GUEST_NAV_COLLAPSED: "pj.local.shell.guestNavCollapsed",
	/**
	 * The `/projects` feed's applied filter state, partitioned BY context id. Stored as a single JSON
	 * map (`Record<contextId, ProjectFeedParams>`) under this one key — the `StorageKey` union is
	 * closed, so we can't synthesise a per-context key literal; the partition lives inside the value.
	 * Lets each workspace reload exactly the filters the actor last left it on (the Continuity rule).
	 */
	PROJECTS_FILTERS: "pj.local.projects.filters",
	/**
	 * The Project Details sidebar's channel-tree accordion open/closed state — a JSON
	 * `Record<groupKey, boolean>` (`general|stages|teams|dms`). Persists the user's collapse
	 * preference across reloads; read after hydration (never during SSR) so it can't cause a
	 * hydration mismatch against the server-rendered defaults.
	 */
	PROJECT_CHANNEL_GROUPS: "pj.local.projects.channelGroups",
	/**
	 * Per-channel preference map for the channel-header actions (§1) — a JSON
	 * `Record<channelId, { starred?: boolean; muted?: boolean; pinned?: boolean }>`. The channel Star
	 * toggle, plus the kebab menu's Mute / Pin toggles, persist here optimistically until the live
	 * backend (`projects.channel_prefs`, behind `PROJECTS_BACKEND_LIVE`) owns them. Read after hydration
	 * only, so it never diverges from the SSR-painted baseline.
	 */
	PROJECT_CHANNEL_PREFS: "pj.local.projects.channelPrefs",
	/**
	 * The File Explorer's zoom-driven view density (a `0`–`1` float). Below the centre threshold the
	 * workspace is the list/table view; above it, the grid — and within each half the value scales the
	 * card/thumbnail size. Shared cross-island (the footer View Control Rig ↔ the explorer body).
	 */
	FILES_ZOOM: "pj.local.files.zoom",
	/** Persisted File Explorer table column widths — a single JSON `Record<columnKey, px>` map. */
	FILES_COLUMNS: "pj.local.files.columns",
	/**
	 * The Catalogue console's zoom-driven view density (a `0`–`1` float) — the same list⇄grid model as
	 * the File Explorer, shared cross-island (the footer View Control Rig ↔ the console body). Its own key
	 * so the seller's catalogue density is independent of their file density.
	 */
	CATALOGUE_ZOOM: "pj.local.catalogue.zoom",
	/**
	 * The Wallet Transactions ledger zoom-driven view density (a `0`–`1` float) — the same list⇄grid
	 * model as the File Explorer, shared cross-island (the footer View Control Rig ↔ the ledger body).
	 * Its own key so the ledger density is independent of the file/catalogue density.
	 */
	WALLET_ZOOM: "pj.local.wallet.zoom",
	/** Persisted Wallet Transactions table column widths — a single JSON `Record<columnKey, px>` map. */
	WALLET_COLUMNS: "pj.local.wallet.columns",
	/** The Wallet lane's last-selected wallet param (`personal` | `team:{id}` | …) — restored across reloads. */
	WALLET_ACTIVE: "pj.local.wallet.active",
	/**
	 * The workspace console's zoom-driven view density (a `0`–`1` float) — the same list⇄grid model as
	 * the File Explorer, shared cross-island (the footer rig ↔ the roster / people body). One key across
	 * `/teams` and `/businesses`: they are one surface parameterised by kind, so a reader who set a
	 * comfortable density on their teams expects the same on their businesses.
	 */
	WORKSPACE_ZOOM: "pj.local.workspace.zoom",
	/**
	 * The Kanban board's view mode (`kanban` | `list`) — shared cross-island (the footer View Control
	 * Rig ↔ the board body), so the board reopens in the last-used surface.
	 */
	BOARD_VIEW: "pj.local.board.view",
	/** The project board's column grouping (`stages` | `statuses`), remembered across sessions. */
	BOARD_GROUPING: "pj.local.board.grouping",
	/**
	 * The shopping basket — a JSON array of the item ids the visitor has added from an Entity View page
	 * (`/view/[id]`). A client-side stub until the `/api/basket` endpoint lands; shared cross-island so
	 * the sidebar CTA reflects the current basket membership.
	 */
	BASKET: "pj.local.basket",
	/**
	 * The `/messages` inbox sidebar's applied search + partition + advanced-filter state — a single JSON
	 * blob (`ConversationListParams`, sans cursor). Restores the last-left inbox filters across reloads
	 * (the Continuity rule). Read after hydration only, so it never diverges from the SSR baseline.
	 */
	MESSAGES_FILTERS: "pj.local.messages.filters",
	/**
	 * Per-conversation preference map for the sidebar conversation-state actions (task §2A) — a JSON
	 * `Record<conversationId, { starred?: boolean; archived?: boolean; muted?: boolean; deleted?: boolean }>`.
	 * The Star / Archive / Mute / soft-Delete actions persist here optimistically until the live backend
	 * (`messages.conversation_prefs`, behind `MESSAGING_BACKEND_LIVE`) owns them.
	 */
	CONVERSATION_PREFS: "pj.local.messages.conversationPrefs",
	/**
	 * The Message Settings (auto-responses + notification preferences) — a JSON `MessagingSettings` blob.
	 * A client-side stub until `MESSAGING_BACKEND_LIVE` owns the write path; read after hydration to
	 * hydrate the settings modal with the viewer's last-saved local edits over the SSR baseline.
	 */
	MESSAGING_SETTINGS: "pj.local.messages.settings",
	/**
	 * DEV-ONLY. Persisted screen position of the Dev Tools Context-Switcher window (`{x,y}` JSON), so it
	 * reopens where the developer left it. Inert in production (the Dev Tools are build-excluded).
	 */
	DEV_CONTEXT_WINDOW_POS: "pj.local.dev.contextWindowPos",
	/** DEV-ONLY. Persisted screen position of the Dev Tools Log & API Inspector window (`{x,y}` JSON). */
	DEV_INSPECTOR_WINDOW_POS: "pj.local.dev.inspectorWindowPos",
	/**
	 * DEV-ONLY. Persisted size of the Dev Tools Context-Switcher window (`{w,h}` px JSON), so a window
	 * resized via its corner handle reopens at that size. Inert in production (Dev Tools are build-excluded).
	 */
	DEV_CONTEXT_WINDOW_SIZE: "pj.local.dev.contextWindowSize",
	/** DEV-ONLY. Persisted size of the Dev Tools Log & API Inspector window (`{w,h}` px JSON). */
	DEV_INSPECTOR_WINDOW_SIZE: "pj.local.dev.inspectorWindowSize",
	/**
	 * DEV-ONLY. Whether the Context-Switcher window is currently OPEN (`"1"`|`"0"`), so an open window
	 * reappears (in its saved position) after a navigation or hard refresh. Inert in production.
	 */
	DEV_CONTEXT_WINDOW_OPEN: "pj.local.dev.contextWindowOpen",
	/** DEV-ONLY. Whether the Log & API Inspector window is currently OPEN (`"1"`|`"0"`). */
	DEV_INSPECTOR_WINDOW_OPEN: "pj.local.dev.inspectorWindowOpen",
	/**
	 * DEV-ONLY. The persisted dev log ring buffer (a JSON `LogEntry[]`), so captured logs survive page
	 * navigations and hard refreshes (F5). Written through by the logger while "keep logs on refresh" is
	 * on, and flushed on page unload when it is off. Inert in production (the logger keeps no history
	 * there, so nothing is ever written).
	 */
	DEV_LOG_CACHE: "pj.local.dev.logCache",
	/**
	 * DEV-ONLY. The "Keep logs on refresh" preference (`"1"`|`"0"`, default on) — the Log Inspector's
	 * persistence switch. Governs whether {@link DEV_LOG_CACHE} carries over a reload or is flushed on
	 * unload. Inert in production.
	 */
	DEV_LOG_PERSIST: "pj.local.dev.logPersist",
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
