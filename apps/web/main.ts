import { App, staticFiles, trailingSlashes } from "fresh";
import type { State } from "@web/utils/state.ts";

/**
 * Projective server entry (Fresh 2.x + Vite).
 *
 * Global middleware order:
 *   1. staticFiles()        — serve /static assets
 *   2. trailingSlashes()    — canonical URLs (no trailing slash)
 *   3. fsRoutes()           — file-system routing over ./routes
 *
 * Auth guarding is NOT global — it is scoped to `routes/(dashboard)/_middleware.ts` so public
 * routes (marketing, auth, and the [handle] profile namespace) stay reachable without a session.
 * Thin routes / fat services: route handlers only parse + validate + delegate (SYSTEM_ARCHITECTURE §2).
 */
export const app = new App<State>()
	.use(staticFiles())
	.use(trailingSlashes("never"))
	.fsRoutes();
