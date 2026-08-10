import { App, staticFiles, trailingSlashes } from "fresh";
import { load } from "@std/dotenv";
import type { State } from "@web/utils/state.ts";

// Populate Deno.env from the workspace `.env` before any route/service resolves the Environment
// Variable Contract (packages/backend/core/env.ts). Without this the server only sees vars already
// exported in the launching shell, so the live flags + Supabase config silently degrade to their
// stub paths. `export: true` never overwrites vars the platform already injected, so production —
// where real values arrive via the environment, not a file — is unaffected. (`examplePath` was
// dropped from `LoadOptions` in @std/dotenv 0.221; the strict `.env.example` check it disabled no
// longer exists, so passing it is now a type error rather than a no-op.)
await load({ export: true });

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
