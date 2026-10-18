import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import {
	buildSitemapXml,
	escapeXml,
	SITEMAP_URL_LIMIT,
	sitemapEntries,
	type SitemapEntry,
	type SitemapSources,
	STATIC_SITEMAP_PATHS,
} from "./sitemap.ts";

const SOURCES: SitemapSources = {
	help: [
		{
			category: { slug: "getting-started" },
			articles: [
				{ category: "getting-started", slug: "what-is-projective", updatedAt: "2026-10-15" },
				{ category: "getting-started", slug: "choose-a-project-type", updatedAt: "2026-10-17" },
			],
		},
		{
			category: { slug: "escrow-and-payments" },
			articles: [{ category: "escrow-and-payments", slug: "fees", updatedAt: "2026-10-16" }],
		},
	],
	releases: [
		{ version: "0.3.0", releasedOn: "2026-10-12" },
		{ version: "0.2.0", releasedOn: "2026-09-30" },
	],
	articles: [
		{ slug: "no-hold-no-work", updatedAt: "2026-10-14T09:00:00Z" },
		{ slug: "agile-delivery-in-stages", updatedAt: "2026-10-01T09:00:00Z" },
	],
	legal: [],
};

Deno.test("entries: the static pages, help, the changelog and the articles, each once", () => {
	const entries = sitemapEntries(SOURCES);
	assertEquals(entries.map((e) => e.path), [
		...STATIC_SITEMAP_PATHS,
		"/help",
		"/help/getting-started",
		"/help/getting-started/what-is-projective",
		"/help/getting-started/choose-a-project-type",
		"/help/escrow-and-payments",
		"/help/escrow-and-payments/fees",
		"/changelog",
		"/changelog/0.3.0",
		"/changelog/0.2.0",
		"/articles",
		"/articles/no-hold-no-work",
		"/articles/agile-delivery-in-stages",
	]);
	assertEquals(new Set(entries.map((e) => e.path)).size, entries.length);
});

Deno.test("entries: lastmod is the day each changed; a hub takes its newest, a static page none", () => {
	const by = new Map(sitemapEntries(SOURCES).map((e) => [e.path, e.lastmod]));
	assertEquals(by.get("/about"), undefined);
	assertEquals(by.get("/help"), "2026-10-17");
	assertEquals(by.get("/help/getting-started"), "2026-10-17");
	assertEquals(by.get("/help/escrow-and-payments/fees"), "2026-10-16");
	assertEquals(by.get("/changelog"), "2026-10-12");
	assertEquals(by.get("/changelog/0.2.0"), "2026-09-30");
	assertEquals(by.get("/articles"), "2026-10-14");
	assertEquals(by.get("/articles/no-hold-no-work"), "2026-10-14", "a date-time becomes its day");
});

Deno.test("entries: empty sources still list every hub, with no lastmod; legal pages come last", () => {
	const legal: SitemapEntry[] = [{ path: "/legal", lastmod: "2026-11-01" }, {
		path: "/legal/terms",
		lastmod: "2026-11-01",
	}];
	const entries = sitemapEntries({ help: [], releases: [], articles: [], legal });
	assertEquals(entries.map((e) => e.path), [
		...STATIC_SITEMAP_PATHS,
		"/help",
		"/changelog",
		"/articles",
		"/legal",
		"/legal/terms",
	]);
	assertEquals(entries.find((e) => e.path === "/changelog")?.lastmod, undefined);
});

Deno.test("document: a sitemaps.org urlset of absolute, escaped URLs on the given origin", () => {
	const xml = buildSitemapXml([
		{ path: "/" },
		{ path: "/help/a", lastmod: "2026-10-17" },
		{ path: "/articles/x?a=1&b=2" },
	], "https://projective.example/");
	assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
	assertMatch(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
	assert(xml.includes("<url><loc>https://projective.example/</loc></url>"));
	assert(
		xml.includes(
			"<url><loc>https://projective.example/help/a</loc><lastmod>2026-10-17</lastmod></url>",
		),
	);
	assert(xml.includes("<loc>https://projective.example/articles/x?a=1&amp;b=2</loc>"));
	assert(xml.trimEnd().endsWith("</urlset>"));
	assertEquals((xml.match(/<url>/g) ?? []).length, 3);
});

Deno.test("document: XML escaping, and the one-file ceiling", () => {
	assertEquals(escapeXml(`a&b<c>"d'`), "a&amp;b&lt;c&gt;&quot;d&apos;");
	const tooMany = Array.from({ length: SITEMAP_URL_LIMIT + 1 }, (_, i) => ({ path: `/p/${i}` }));
	assertThrows(() => buildSitemapXml(tooMany, "https://projective.example"), RangeError);
});
