import { define } from "@web/utils/state.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { HelpBackendService } from "@server/services/editorial/HelpBackendService.ts";
import { ChangelogBackendService } from "@server/services/editorial/ChangelogBackendService.ts";
import { EditorialArticlesBackendService } from "@server/services/editorial/EditorialArticlesBackendService.ts";
import { LEGAL_LIBRARY, legalToday } from "@features/legal/core/registry.ts";
import { legalSitemapEntries } from "@features/legal/core/sitemap.ts";
import { buildSitemapXml, sitemapEntries } from "../core/sitemap.ts";

/**
 * `GET /sitemap.xml` — every public page a search engine should index (PUBLIC_ROUTES P8, Decision
 * #279), re-exported by `routes/(public)/sitemap.xml.ts`.
 *
 * Thin: read the help centre, the changelog and Projective's articles through their services (each
 * applies its own visibility — published, not archived, dated today or earlier — on both roads), pick
 * the reviewed legal pages, and serialise them with `buildSitemapXml` on the site's public origin.
 * Cached for an hour in shared caches: the content changes when a migration lands or a release day
 * arrives. A source that cannot be read is a plain-text 503 with `Retry-After`, never a sitemap with a
 * section missing — a crawler would read the gap as pages that no longer exist.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const [help, releases, articles] = await Promise.all([
			HelpBackendService.snapshot(),
			ChangelogBackendService.releases(),
			EditorialArticlesBackendService.listed(),
		]);
		if (
			!help.ok || !help.data || !releases.ok || !releases.data || !articles.ok || !articles.data
		) {
			return new Response("The sitemap is unavailable right now. Please try again shortly.\n", {
				status: 503,
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-store",
					"retry-after": "300",
				},
			});
		}
		const entries = sitemapEntries({
			help: help.data.library.topics,
			releases: releases.data.releases,
			articles: articles.data,
			legal: legalSitemapEntries(LEGAL_LIBRARY, legalToday()),
		});
		return new Response(buildSitemapXml(entries, siteOrigin(ctx.url)), {
			headers: {
				"content-type": "application/xml; charset=utf-8",
				"cache-control": "public, max-age=3600",
			},
		});
	},
});
