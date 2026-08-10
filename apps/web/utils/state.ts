import { createDefine } from "fresh";
import type { UserContext } from "@projective/types/auth";
import type { FxRateTable } from "@projective/types/finance";
import type { ProfileView } from "@projective/types/profile";

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
	 * The session access token for THIS request. Normally the value of the `sb-access-token` cookie;
	 * when the dashboard guard silently renews an expired session from the refresh token, it is the
	 * freshly-minted token (the request cookie is stale until the response's `Set-Cookie` lands). Live
	 * reads should use this rather than re-reading the cookie so a just-refreshed request is scoped to
	 * the new token.
	 */
	accessToken?: string;
	/**
	 * The hydrated, chrome-only user context — resolved site-wide by `routes/_middleware.ts` from the
	 * session JWT so SSR can paint the correct shell + skeletons in the first byte (User Context
	 * Hydration). Read-only visual guide: RLS + the `(dashboard)` guard remain the real gates.
	 */
	userContext?: UserContext;
	/**
	 * The resolved money-presentation context — the currency + locale every figure is formatted in,
	 * plus the FX rate table needed to re-project one. Set site-wide by `routes/_middleware.ts`.
	 *
	 * It ships into SSR (and into the document's pre-paint attributes in `_app.tsx`) so the very first
	 * byte already carries the viewer's own currency: a price that paints in GBP and corrects itself
	 * to EUR after hydration is a worse experience than one that takes a moment to arrive, and on a
	 * money surface it is actively alarming.
	 *
	 * Presentation only. Nothing derived from this changes a stored amount or a settlement.
	 */
	currency?: {
		displayCurrency: string;
		locale: string;
		table: FxRateTable;
	};
	/** Active persona/profile handle, when resolved. */
	handle?: string;
	/**
	 * The resolved public profile for a `/[handle]` request — set by `routes/[handle]/_middleware.ts`
	 * from the fat `ProfileBackendService` so the shared layout (shell · action lane · sticky header ·
	 * meta rail) and every tab sub-route read one projection. `null` for a reserved/unresolved handle.
	 */
	profile?: ProfileView | null;
}

/** The typed `define` helper (`define.page` · `define.handlers` · `define.middleware`). */
export const define = createDefine<State>();
