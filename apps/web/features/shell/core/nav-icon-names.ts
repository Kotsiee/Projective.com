/**
 * nav-icon-names — the names of the shell's glyph set, apart from the glyphs themselves, so a pure
 * model (`nav-model`, `actions-model`) can name an icon without loading `@projective/ui/icons` and its
 * stylesheet — which `deno test` refuses.
 */

// #region Names
/** Every glyph the navigation shell can render. */
export type IconName =
	| "home"
	| "explore"
	| "messages"
	| "projects"
	| "services"
	| "teams"
	| "business"
	| "dashboard"
	| "analytics"
	| "wallet"
	| "settings"
	| "create"
	| "notifications"
	| "basket"
	| "search"
	| "chevron"
	| "sidebar"
	| "product"
	| "article"
	| "user"
	| "logout"
	| "briefcase"
	| "calendar"
	| "files"
	| "switch"
	| "check"
	| "arrowLeft"
	| "sun"
	| "moon"
	| "monitor"
	| "clock"
	| "saved"
	| "feedback";
// #endregion
