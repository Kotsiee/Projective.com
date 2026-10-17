/**
 * The site's public origin for canonical URLs, `og:url` and every JSON-LD `@id` — SERVER-ONLY (it
 * reads the environment; never import it from an island).
 *
 * `ctx.url.origin` is the origin the request arrived on, built from its Host header. Deployed behind
 * a TLS-terminating proxy that is the internal `http://host:port`, and a client that sends its own
 * Host header would write it into the page's canonical link. The Environment Variable Contract
 * names `APP_URL` as the public origin anywhere deployed (`serverEnv().appUrl`), so production reads
 * that; development keeps the request's own origin, which is the one the developer is browsing
 * (`APP_URL` there defaults to `http://localhost:<PORT>`, not necessarily the dev server's).
 *
 * @module
 */
import { serverEnv } from "@projective/backend/core/env.ts";

/** The environment facts {@link siteOrigin} reads (injectable for tests). */
export interface SiteOriginEnv {
	/** `DENO_ENV`: `production` or `development`. */
	appEnv: string;
	/** `APP_URL`. */
	appUrl: string;
}

/**
 * The public origin to build absolute page URLs on: `APP_URL`'s origin in production (when it
 * parses as an `http(s)` URL), else the request's own origin.
 *
 * @example
 * ```ts
 * applyPageMeta(ctx.state, pageMeta({ …, path: "/legal/terms", origin: siteOrigin(ctx.url) }));
 * ```
 */
export function siteOrigin(requestUrl: URL, env: SiteOriginEnv = serverEnv()): string {
	if (env.appEnv === "production" && URL.canParse(env.appUrl)) {
		const configured = new URL(env.appUrl);
		if (configured.protocol === "https:" || configured.protocol === "http:") {
			return configured.origin;
		}
	}
	return requestUrl.origin;
}
