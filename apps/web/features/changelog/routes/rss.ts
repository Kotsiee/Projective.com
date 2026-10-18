import { define } from "@web/utils/state.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { ChangelogBackendService } from "@server/services/editorial/ChangelogBackendService.ts";
import { buildChangelogRss } from "../core/rss.ts";

/**
 * `/changelog/rss.xml` — the changelog as RSS 2.0 (P5, Decision #278), re-exported by
 * `routes/(public)/changelog/rss.xml.ts`.
 *
 * Thin: read every visible release from {@link ChangelogBackendService.releases}, serialise them
 * with `buildChangelogRss` on the site's public origin, answer `application/rss+xml`. Cached for 15
 * minutes in shared caches — readers poll, and the document only changes when a release ships. A
 * failed read is a plain-text 503 with `Retry-After`, never an empty feed (a reader would take an
 * empty channel as "every release was removed").
 */
export const handler = define.handlers({
	async GET(ctx) {
		const result = await ChangelogBackendService.releases();
		if (!result.ok || !result.data) {
			return new Response(
				"The changelog feed is unavailable right now. Please try again shortly.\n",
				{
					status: 503,
					headers: {
						"content-type": "text/plain; charset=utf-8",
						"cache-control": "no-store",
						"retry-after": "60",
					},
				},
			);
		}
		const xml = buildChangelogRss(result.data.releases, { origin: siteOrigin(ctx.url) });
		return new Response(xml, {
			headers: {
				"content-type": "application/rss+xml; charset=utf-8",
				"cache-control": "public, max-age=900",
			},
		});
	},
});
