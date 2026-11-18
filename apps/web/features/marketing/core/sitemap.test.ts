import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import {
	buildSitemapIndexXml,
	buildSitemapXml,
	type CatalogueSitemapSources,
	chunkSitemapEntries,
	escapeXml,
	listingSitemapEntries,
	profileSitemapEntries,
	readSitemapRequest,
	SITEMAP_BYTE_LIMIT,
	SITEMAP_URL_LIMIT,
	sitemapEntries,
	type SitemapEntry,
	sitemapFilePath,
	sitemapFiles,
	type SitemapSources,
	STATIC_SITEMAP_PATHS,
} from "./sitemap.ts";
import { sitemapSourcesOf } from "@server/services/explore/sitemap-sources.ts";
import {
	SITEMAP_FIXTURE_LISTED_HANDLES,
	SITEMAP_FIXTURE_LISTED_SLUGS,
	SITEMAP_FIXTURE_REFUSED,
	sitemapFixtureCatalog,
} from "@server/services/explore/sitemap-fixtures.ts";

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

Deno.test("entries: the landing pages lead — the home page, then its features index", () => {
	const entries = sitemapEntries(SOURCES);
	assertEquals(entries.slice(0, 2), [{ path: "/" }, { path: "/features" }]);
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

// #region Marketplace sections
const ORIGIN = "https://projective.example";
const MARKETPLACE: CatalogueSitemapSources = {
	listings: [
		{ slug: "svc-zzzz222222", updatedAt: "2026-11-02T08:30:00Z" },
		{ slug: "art-aaaa222222", updatedAt: "2026-10-05T00:00:00Z" },
		{ slug: "prd-mmmm222222", updatedAt: "2026-10-20" },
	],
	profiles: [{ handle: "@studio" }, { handle: "ana" }, { handle: "@acme" }],
};

Deno.test("listings: each at its canonical /view/:slug, on its row's day, in path order", () => {
	assertEquals(listingSitemapEntries(MARKETPLACE), [
		{ path: "/view/art-aaaa222222", lastmod: "2026-10-05" },
		{ path: "/view/prd-mmmm222222", lastmod: "2026-10-20" },
		{ path: "/view/svc-zzzz222222", lastmod: "2026-11-02" },
	]);
});

Deno.test("profiles: each at /@handle with no lastmod, in path order, never twice", () => {
	const twice = { ...MARKETPLACE, profiles: [...MARKETPLACE.profiles, { handle: "@ana" }] };
	assertEquals(profileSitemapEntries(twice), [
		{ path: "/@acme" },
		{ path: "/@ana" },
		{ path: "/@studio" },
	]);
});
// #endregion

// #region Addresses
Deno.test("request: no query is the index; a section and a page from 2 is one file", () => {
	const read = (query: string) => readSitemapRequest(new URLSearchParams(query));
	assertEquals(read(""), { kind: "index" });
	assertEquals(read("section=pages"), { kind: "file", section: "pages", page: 1 });
	assertEquals(read("section=listings&page=2"), { kind: "file", section: "listings", page: 2 });
	assertEquals(read("page=2&section=profiles"), { kind: "file", section: "profiles", page: 2 });
});

Deno.test("request: every other spelling is no file", () => {
	for (
		const query of [
			"page=2",
			"section=projects",
			"section=Pages",
			"section=pages&section=listings",
			"section=listings&page=1",
			"section=listings&page=02",
			"section=listings&page=0",
			"section=listings&page=-1",
			"section=listings&page=2.0",
			"section=listings&page=",
			"section=listings&page=2&page=3",
			"section=listings&page=99999999999",
		]
	) {
		assertEquals(readSitemapRequest(new URLSearchParams(query)), null, query);
	}
});

Deno.test("file path: the index's own path with the section, and the page from 2", () => {
	assertEquals(sitemapFilePath("pages", 1), "/sitemap.xml?section=pages");
	assertEquals(sitemapFilePath("listings", 3), "/sitemap.xml?section=listings&page=3");
	assertEquals(
		readSitemapRequest(new URL(sitemapFilePath("listings", 3), ORIGIN).searchParams),
		{ kind: "file", section: "listings", page: 3 },
	);
});
// #endregion

// #region Chunks and the index
const many = (n: number): SitemapEntry[] =>
	Array.from({ length: n }, (_, i) => ({ path: `/view/svc-${String(i).padStart(10, "0")}` }));

Deno.test("chunks: at most the URL limit each, in order, none empty", () => {
	const chunks = chunkSitemapEntries(many(7), ORIGIN, { urls: 3, bytes: SITEMAP_BYTE_LIMIT });
	assertEquals(chunks.map((c) => c.length), [3, 3, 1]);
	assertEquals(chunks.flat(), many(7));
	assertEquals(chunkSitemapEntries([], ORIGIN), []);
});

Deno.test("chunks: never past the byte limit, and as full as it allows", () => {
	const entries = many(40);
	const bytes = new TextEncoder().encode(buildSitemapXml(entries.slice(0, 5), ORIGIN)).length;
	const chunks = chunkSitemapEntries(entries, ORIGIN, { urls: SITEMAP_URL_LIMIT, bytes });
	assertEquals(chunks.length, 8);
	for (const chunk of chunks) {
		assertEquals(new TextEncoder().encode(buildSitemapXml(chunk, ORIGIN)).length, bytes);
	}
	assertThrows(
		() => chunkSitemapEntries(entries, ORIGIN, { urls: SITEMAP_URL_LIMIT, bytes: 120 }),
		RangeError,
	);
});

Deno.test("files: sections in index order, an empty section has none, each dated by its newest", () => {
	const files = sitemapFiles(
		{
			pages: [{ path: "/" }, { path: "/help", lastmod: "2026-10-17" }],
			listings: listingSitemapEntries(MARKETPLACE),
			profiles: [],
		},
		ORIGIN,
		{ urls: 2, bytes: SITEMAP_BYTE_LIMIT },
	);
	assertEquals(
		files.map((f) => [f.path, f.lastmod]),
		[
			["/sitemap.xml?section=pages", "2026-10-17"],
			["/sitemap.xml?section=listings", "2026-10-20"],
			["/sitemap.xml?section=listings&page=2", "2026-11-02"],
		],
	);
});

Deno.test("index: a sitemaps.org sitemapindex of absolute, escaped file addresses", () => {
	const xml = buildSitemapIndexXml([
		{ path: "/sitemap.xml?section=pages", lastmod: "2026-10-17" },
		{ path: "/sitemap.xml?section=listings&page=2" },
	], `${ORIGIN}/`);
	assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
	assertMatch(xml, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
	assert(
		xml.includes(
			`<sitemap><loc>${ORIGIN}/sitemap.xml?section=pages</loc><lastmod>2026-10-17</lastmod></sitemap>`,
		),
	);
	assert(xml.includes(`<loc>${ORIGIN}/sitemap.xml?section=listings&amp;page=2</loc>`));
	assert(xml.trimEnd().endsWith("</sitemapindex>"));
	assertThrows(() => buildSitemapIndexXml([], ORIGIN), RangeError);
});
// #endregion

// #region End to end
Deno.test("end to end: no private, unlisted, minor, archived, draft or brief URL is ever emitted", () => {
	const marketplace = sitemapSourcesOf(sitemapFixtureCatalog());
	const files = sitemapFiles({
		pages: sitemapEntries(SOURCES),
		listings: listingSitemapEntries(marketplace),
		profiles: profileSitemapEntries(marketplace),
	}, ORIGIN);
	const locs = files.flatMap((f) =>
		[...buildSitemapXml(f.entries, ORIGIN).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
	);
	for (const [ref, why] of Object.entries(SITEMAP_FIXTURE_REFUSED)) {
		const path = ref.startsWith("@") ? `/${ref}` : `/view/${ref}`;
		assert(!locs.some((loc) => new URL(loc).pathname === path), `${path} is listed: ${why}`);
	}
	for (const slug of SITEMAP_FIXTURE_LISTED_SLUGS) {
		assert(locs.includes(`${ORIGIN}/view/${slug}`), `${slug} is missing`);
	}
	for (const handle of SITEMAP_FIXTURE_LISTED_HANDLES) {
		assert(locs.includes(`${ORIGIN}/${handle}`), `${handle} is missing`);
	}
	assertEquals(
		locs.filter((loc) => /\/view\/|\/@/.test(new URL(loc).pathname)).length,
		SITEMAP_FIXTURE_LISTED_SLUGS.length + SITEMAP_FIXTURE_LISTED_HANDLES.length,
		"nothing else from the marketplace",
	);
});
// #endregion
