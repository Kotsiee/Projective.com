import { createDefine } from "fresh";
import type { UserContext } from "@projective/types/auth";

/**
 * Request-scoped state shared across middleware, handlers, and pages.
 *
 * Kept intentionally small for the skeleton. Auth/session fields are populated by
 * `routes/(dashboard)/_middleware.ts` once real Supabase JWT verification is wired in.
 */
export interface State {
	/** Page <title>, set per-route or by a layout. */
	title?: string;
	/** Meta description for public/SEO routes. */
	description?: string;
	/** Whether the current request is authenticated (set by the dashboard guard). */
	isAuthenticated?: boolean;
	/**
	 * The hydrated, chrome-only user context — resolved site-wide by `routes/_middleware.ts` from the
	 * session JWT so SSR can paint the correct shell + skeletons in the first byte (User Context
	 * Hydration). Read-only visual guide: RLS + the `(dashboard)` guard remain the real gates.
	 */
	userContext?: UserContext;
	/** Active persona/profile handle, when resolved. */
	handle?: string;
}

/** The typed `define` helper (`define.page` · `define.handlers` · `define.middleware`). */
export const define = createDefine<State>();
