import { define } from "@web/utils/state.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { HelpBackendService } from "@server/services/editorial/HelpBackendService.ts";
import { ChangelogBackendService } from "@server/services/editorial/ChangelogBackendService.ts";
import { EditorialArticlesBackendService } from "@server/services/editorial/EditorialArticlesBackendService.ts";
import { ExploreSitemapService } from "@server/services/explore/ExploreSitemapService.ts";
import { LEGAL_LIBRARY, legalToday } from "@features/legal/core/registry.ts";
import { legalSitemapEntries } from "@features/legal/core/sitemap.ts";
import {
	buildSitemapIndexXml,
	buildSitemapXml,
	listingSitemapEntries,
	profileSitemapEntries,
	readSitemapRequest,
	SITEMAP_SECTIONS,
	sitemapEntries,
	type SitemapEntry,
	sitemapFiles,
	type SitemapSection,
	type SitemapSectionEntries,
} from "../core/sitemap.ts";

/**
 * `GET /sitemap.xml` — the sitemap index, and `GET /sitemap.xml?section=…[&page=…]` one of its files
 * (PUBLIC_ROUTES P8, Decisions #279 and #452), re-exported by `routes/(public)/sitemap.xml.ts`.
 *
 * Thin: parse the query (`readSitemapRequest`), read the sources the request needs through their
 * services, and serialise with the pure builders on the site's public origin. `pages` reads the help
 * centre, the changelog and Projective's articles (each applies its own visibility on both roads) and
 * picks the reviewed legal pages; `listings` and `profiles` read `ExploreSitemapService`, which reads
 * the anonymous discovery catalogue: no session, no service role. The index reads every section,
 * since it names each one's chunks.
 *
 * Cached for an hour in shared caches. A source that cannot be read is a plain-text 503 with
 * `Retry-After`, never a document with a section missing: a crawler would read the gap as pages that
 * no longer exist. An address the index does not name is a plain-text 404.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const request = readSitemapRequest(ctx.url.searchParams);
		if (!request) return notFound();
		const sections = await readSections(
			request.kind === "index" ? SITEMAP_SECTIONS : [request.section],
		);
		if (!sections) return unavailable();
		const origin = siteOrigin(ctx.url);
		const files = sitemapFiles(sections, origin);
		if (request.kind === "index") return xml(buildSitemapIndexXml(files, origin));
		const file = files.find((f) => f.section === request.section && f.page === request.page);
		return file ? xml(buildSitemapXml(file.entries, origin)) : notFound();
	},
});

/** Each requested section's entries, or `null` when any source behind them cannot be read. */
async function readSections(
	wanted: readonly SitemapSection[],
): Promise<SitemapSectionEntries | null> {
	const needsPages = wanted.includes("pages");
	const needsCatalogue = wanted.includes("listings") || wanted.includes("profiles");
	const [pages, catalogue] = await Promise.all([
		needsPages ? readPages() : Promise.resolve(undefined),
		needsCatalogue ? ExploreSitemapService.sources() : Promise.resolve(undefined),
	]);
	if (pages === null) return null;
	if (catalogue && (!catalogue.ok || !catalogue.data)) return null;
	const marketplace = catalogue?.data;
	return {
		...(pages ? { pages } : {}),
		...(marketplace && wanted.includes("listings")
			? { listings: listingSitemapEntries(marketplace) }
			: {}),
		...(marketplace && wanted.includes("profiles")
			? { profiles: profileSitemapEntries(marketplace) }
			: {}),
	};
}

/** The `pages` section, or `null` when the help centre, the changelog or the articles are unreadable. */
async function readPages(): Promise<SitemapEntry[] | null> {
	const [help, releases, articles] = await Promise.all([
		HelpBackendService.snapshot(),
		ChangelogBackendService.releases(),
		EditorialArticlesBackendService.listed(),
	]);
	if (!help.ok || !help.data || !releases.ok || !releases.data || !articles.ok || !articles.data) {
		return null;
	}
	return sitemapEntries({
		help: help.data.library.topics,
		releases: releases.data.releases,
		articles: articles.data,
		legal: legalSitemapEntries(LEGAL_LIBRARY, legalToday()),
	});
}

function xml(body: string): Response {
	return new Response(body, {
		headers: {
			"content-type": "application/xml; charset=utf-8",
			"cache-control": "public, max-age=3600",
		},
	});
}

function notFound(): Response {
	return new Response("There is no such sitemap file. The index is /sitemap.xml.\n", {
		status: 404,
		headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
	});
}

function unavailable(): Response {
	return new Response("The sitemap is unavailable right now. Please try again shortly.\n", {
		status: 503,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
			"retry-after": "300",
		},
	});
}
