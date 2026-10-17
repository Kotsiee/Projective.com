import { assert, assertEquals } from "@std/assert";
import type { ChangelogRelease } from "@projective/types/editorial";
import { pageMeta, serializeJsonLd } from "@features/marketing/core/seo.ts";
import {
	feedJsonLd,
	feedPageMeta,
	releaseJsonLd,
	releaseLabel,
	releasePageMeta,
} from "./changelog-meta.ts";
import { galleriesFor } from "./galleries.ts";

const origin = "https://projective.test";

const release = {
	version: "0.12.0",
	releasedOn: "2026-10-11",
	title: "Funding before work",
	summary: "No work starts until it is funded.",
	categories: ["escrow"],
	body: [{ type: "p", content: "A ticket moves into work once its payment is held." }],
	images: [
		{
			src: "https://placehold.co/1600x1000?text=Needs+funding",
			alt: "A ticket waiting in Needs funding",
			w: 1600,
			h: 1000,
			caption: "Waiting for its payment.",
		},
		{ src: "/test_images/banner_2.jpg", alt: "A second capture", w: 1280, h: 720 },
	],
	withdrawn: false,
} satisfies ChangelogRelease;

const bare = { ...release, version: "0.11.0", images: [] } satisfies ChangelogRelease;

/** The `@graph` node of a given type. */
function node(graph: { "@graph": Array<Record<string, unknown>> }, type: string) {
	const found = graph["@graph"].find((n) => n["@type"] === type);
	if (!found) throw new Error(`no ${type} node`);
	return found;
}

Deno.test("feed meta: canonical /changelog, the RSS alternate, a website preview", () => {
	const meta = pageMeta(feedPageMeta(origin));
	assertEquals(meta.canonical, "https://projective.test/changelog");
	assertEquals(meta.title, "Changelog · Projective");
	assertEquals(meta.robots, "index, follow");
	assertEquals(meta.og.type, "website");
	assertEquals(meta.alternates, [{
		type: "application/rss+xml",
		href: "https://projective.test/changelog/rss.xml",
		title: "Projective changelog",
	}]);
});

Deno.test("feed graph: a CollectionPage whose ItemList is the page's releases", () => {
	const graph = feedJsonLd(origin, [release, bare], "2026-10-11");
	const page = node(graph, "CollectionPage");
	assertEquals(page.dateModified, "2026-10-11");
	const list = page.mainEntity as { itemListElement: Array<Record<string, unknown>> };
	assertEquals(list.itemListElement.map((i) => [i.position, i.name, i.url]), [
		[1, "v0.12.0 — Funding before work", "https://projective.test/changelog/0.12.0"],
		[2, "v0.11.0 — Funding before work", "https://projective.test/changelog/0.11.0"],
	]);
	node(graph, "Organization");
	node(graph, "WebSite");
	assertEquals(JSON.parse(serializeJsonLd(graph)), JSON.parse(JSON.stringify(graph)));
});

Deno.test("release meta: an article on its own canonical path, its first picture as the preview", () => {
	const meta = pageMeta(releasePageMeta(origin, release));
	assertEquals(meta.canonical, "https://projective.test/changelog/0.12.0");
	assertEquals(meta.og.type, "article");
	assertEquals(meta.og.publishedAt, "2026-10-11");
	assertEquals(meta.og.image?.url, release.images[0].src);
	assertEquals(meta.twitterCard, "summary_large_image");
	assertEquals(pageMeta(releasePageMeta(origin, bare)).og.image, undefined);
});

Deno.test("release graph: a TechArticle about Projective at this softwareVersion, with a breadcrumb", () => {
	const graph = releaseJsonLd(origin, release);
	const article = node(graph, "TechArticle");
	assertEquals(article.headline, "Funding before work");
	assertEquals(article.datePublished, "2026-10-11");
	assertEquals(article.version, "0.12.0");
	assertEquals(article.about, {
		"@type": "SoftwareApplication",
		name: "Projective",
		applicationCategory: "BusinessApplication",
		operatingSystem: "Web",
		softwareVersion: "0.12.0",
	});
	assert((article.wordCount as number) > 5);
	const crumbs = node(graph, "BreadcrumbList").itemListElement as Array<Record<string, unknown>>;
	assertEquals(crumbs.map((c) => c.item), [
		"https://projective.test/changelog",
		"https://projective.test/changelog/0.12.0",
	]);
	node(graph, "WebPage");
});

Deno.test("galleries: one per release with pictures, keyed by its anchor, captions kept", () => {
	assertEquals(releaseLabel(release), "v0.12.0 — Funding before work");
	assertEquals(galleriesFor([release, bare]), [{
		entry: "v0-12-0",
		title: "v0.12.0 — Funding before work",
		images: [
			{
				src: release.images[0].src,
				alt: release.images[0].alt,
				caption: "Waiting for its payment.",
			},
			{ src: "/test_images/banner_2.jpg", alt: "A second capture" },
		],
	}]);
});
