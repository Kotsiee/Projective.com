import { assert, assertEquals } from "@std/assert";
import { primeCatalogForTesting } from "./live-catalog.ts";
import { sitemapSourcesOf } from "./sitemap-sources.ts";
import { ExploreSitemapService } from "./ExploreSitemapService.ts";
import {
	SITEMAP_FIXTURE_LISTED_HANDLES,
	SITEMAP_FIXTURE_LISTED_SLUGS,
	SITEMAP_FIXTURE_REFUSED,
	sitemapFixtureCatalog,
} from "./sitemap-fixtures.ts";

const sorted = (values: readonly string[]) => [...values].sort();

Deno.test("sitemap sources: published listings and posts of public owners, and public profiles", () => {
	const sources = sitemapSourcesOf(sitemapFixtureCatalog());
	assertEquals(sorted(sources.listings.map((l) => l.slug)), sorted(SITEMAP_FIXTURE_LISTED_SLUGS));
	assertEquals(
		sorted(sources.profiles.map((p) => p.handle)),
		sorted(SITEMAP_FIXTURE_LISTED_HANDLES),
	);
});

Deno.test("sitemap sources: no draft, paused, archived, unlisted, private, minor or brief row", () => {
	const sources = sitemapSourcesOf(sitemapFixtureCatalog());
	const emitted = new Set([
		...sources.listings.map((l) => l.slug),
		...sources.profiles.map((p) => p.handle),
	]);
	for (const [ref, why] of Object.entries(SITEMAP_FIXTURE_REFUSED)) {
		assert(!emitted.has(ref), `${ref} is listed: ${why}`);
	}
});

Deno.test("sitemap sources: each listing carries its own row's updated_at", () => {
	const bySlug = new Map(
		sitemapSourcesOf(sitemapFixtureCatalog()).listings.map((l) => [l.slug, l.updatedAt]),
	);
	assertEquals(bySlug.get("svc-ana0public"), "2026-11-02T08:30:00Z");
	assertEquals(bySlug.get("prd-ana0public"), "2026-10-20T00:00:00Z");
	assertEquals(bySlug.get("art-ana0public"), "2026-10-05T00:00:00Z");
});

Deno.test("sitemap sources: a listing whose row is not published is refused even if it is loaded", () => {
	const catalog = sitemapFixtureCatalog();
	catalog.publicationById.set("svc-ana0public", { status: "paused", updatedAt: "2026-11-03" });
	catalog.publicationById.delete("prd-ana0public");
	const slugs = sitemapSourcesOf(catalog).listings.map((l) => l.slug);
	assert(!slugs.includes("svc-ana0public"), "a paused row");
	assert(!slugs.includes("prd-ana0public"), "a row with no publication facts");
});

Deno.test("ExploreSitemapService.sources: reads the shared catalogue", async () => {
	primeCatalogForTesting(sitemapFixtureCatalog(), { serve: true });
	try {
		const result = await ExploreSitemapService.sources();
		assert(result.ok && result.data);
		assertEquals(
			sorted(result.data.listings.map((l) => l.slug)),
			sorted(SITEMAP_FIXTURE_LISTED_SLUGS),
		);
	} finally {
		primeCatalogForTesting(null);
	}
});
