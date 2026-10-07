import { createDefine } from "fresh";
import type { UserContext } from "@projective/types/auth";
import type { FxRateTable } from "@projective/types/finance";
import type { ProfileView } from "@projective/types/profile";
import type { A11yOverlays } from "@web/utils/a11y-context.ts";
import type {
	ProjectAccess,
	ProjectNavActivity,
	ProjectStatus,
	ProjectWorkspace,
} from "@projective/types/projects";

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
	/**
	 * The viewer's accessibility overlays (contrast · font · colour vision · motion), read from the
	 * `pj.a11y` cookie by `routes/_middleware.ts` so `_app.tsx` can write them onto `<html>` before the
	 * first paint (`utils/a11y-context.ts`, Decision #150). Presentation only.
	 */
	a11y?: A11yOverlays;
	/** Active persona/profile handle, when resolved. */
	handle?: string;
	/**
	 * The resolved public profile for a `/[handle]` request — set by `routes/[handle]/_middleware.ts`
	 * from the fat `ProfileBackendService` so the shared layout (shell · action lane · sticky header ·
	 * meta rail) and every tab sub-route read one projection. `null` for a reserved/unresolved handle.
	 */
	profile?: ProfileView | null;
	/**
	 * Why `profile` is `null`: `404` for a handle that names nothing the viewer may see, `503` when the
	 * profile could not be read at all — the page then says the database is unavailable rather than
	 * claiming the profile does not exist.
	 */
	profileStatus?: 200 | 404 | 503;
	/**
	 * How the viewer stands toward the engagement a `/projects/[slug]/*` request addresses — resolved
	 * ONCE by `routes/(dashboard)/projects/[projectSlug]/_middleware.ts` (Decision #144) so the page,
	 * the header band and the footer band answer from one value rather than three reads that a dev
	 * simulation could make disagree. Absent on every other route.
	 */
	projectAccess?: {
		/** The routed slug this answer is for — a guard against reading it for another engagement. */
		slug: string;
		title: string;
		access: ProjectAccess;
		status: ProjectStatus;
		/** Whether the engagement has its discussion room (`discussionOf`), so a band may link it. */
		discussion: boolean;
		/** Whether a development-only landing simulation changed either value. */
		simulated: boolean;
	};
	/**
	 * The Overview read the `/projects/[slug]` handler composed, kept for the footer band's rig so the
	 * layout does not compose the same four reads a second time. Absent on every other route.
	 */
	projectWorkspace?: ProjectWorkspace;
	/**
	 * The viewer's lane activity for the engagement a `/projects/[slug]/*` request addresses, read once
	 * so the Overview's arrival highlight and the lane's marks answer from the same instant.
	 */
	projectNavActivity?: { slug: string; activity: ProjectNavActivity };
}

/** The typed `define` helper (`define.page` · `define.handlers` · `define.middleware`). */
export const define = createDefine<State>();
