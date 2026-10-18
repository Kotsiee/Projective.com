import { define } from "@web/utils/state.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { buildRobotsTxt } from "../core/robots.ts";

/**
 * `GET /robots.txt` — what crawlers may fetch (PUBLIC_ROUTES P8, Decision #279), re-exported by
 * `routes/(public)/robots.txt.ts`. Thin: `buildRobotsTxt` on the site's public origin, so the
 * `Sitemap:` line names the deployed address. There must be no `static/robots.txt`: the static-files
 * middleware runs before the routes and would answer first.
 */
export const handler = define.handlers({
	GET(ctx) {
		return new Response(buildRobotsTxt(siteOrigin(ctx.url)), {
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "public, max-age=3600",
			},
		});
	},
});
