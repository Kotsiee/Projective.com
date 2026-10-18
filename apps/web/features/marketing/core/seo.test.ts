/**
 * Page meta and structured data for the public routes.
 *
 * Search engines punish quietly: two canonical spellings of one page split its ranking, a JSON-LD
 * block that breaks out of its `<script>` is ignored (or worse, executed), and a node missing a
 * required property simply never earns its rich result. None of it shows on the page, so the shapes
 * are pinned here.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { SAMPLE_DOC } from "@projective/types/content/fixtures";
import {
	aboutPageJsonLd,
	absoluteUrl,
	applyPageMeta,
	articleJsonLd,
	breadcrumbListJsonLd,
	canonicalUrl,
	collectionPageJsonLd,
	contactPageJsonLd,
	documentTitle,
	faqJsonLdItems,
	faqPageJsonLd,
	jsonLdAuthor,
	jsonLdGraph,
	type JsonLdNode,
	metaImage,
	organizationJsonLd,
	type PageMeta,
	pageMeta,
	serializeJsonLd,
	techArticleJsonLd,
	webPageJsonLd,
	webSiteJsonLd,
} from "./seo.ts";

const ORIGIN = "https://projective.app";

// #region URLs & titles
Deno.test("absoluteUrl joins an origin and a path, and passes absolute URLs through", () => {
	assertEquals(absoluteUrl(ORIGIN, "/legal"), "https://projective.app/legal");
	assertEquals(absoluteUrl(`${ORIGIN}/`, "legal"), "https://projective.app/legal");
	assertEquals(
		absoluteUrl(ORIGIN, "https://placehold.co/1200x630"),
		"https://placehold.co/1200x630",
	);
});

Deno.test("canonicalUrl gives one spelling per page", () => {
	for (
		const path of ["/legal/terms", "/legal/terms/", "/legal/terms?ref=footer", "/legal//terms#fees"]
	) {
		assertEquals(canonicalUrl(ORIGIN, path), "https://projective.app/legal/terms", path);
	}
	assertEquals(canonicalUrl(ORIGIN, "/"), "https://projective.app/");
	assertEquals(canonicalUrl(ORIGIN, "/?q=x"), "https://projective.app/");
});

Deno.test("documentTitle adds the brand once", () => {
	assertEquals(documentTitle("Privacy Policy"), "Privacy Policy · Projective");
	assertEquals(documentTitle("Privacy Policy · Projective"), "Privacy Policy · Projective");
	const landing = "Projective — Hire a ready-made team with payment protection";
	assertEquals(documentTitle(landing), landing);
	assertEquals(documentTitle("Projective"), "Projective");
});
// #endregion

// #region pageMeta
Deno.test("pageMeta: title, canonical, robots and the Open Graph block", () => {
	const meta = pageMeta({
		title: "Terms of Service",
		description: "The rules of the platform.",
		path: "/legal/terms/",
		origin: ORIGIN,
	});
	assertEquals(meta.title, "Terms of Service · Projective");
	assertEquals(meta.canonical, "https://projective.app/legal/terms");
	assertEquals(meta.robots, "index, follow");
	assertEquals(meta.og, {
		type: "website",
		siteName: "Projective",
		title: "Terms of Service",
		description: "The rules of the platform.",
		url: "https://projective.app/legal/terms",
	});
	assertEquals(meta.twitterCard, "summary");
});

Deno.test("pageMeta: noindex, an absolute preview image with its size, article times", () => {
	const meta = pageMeta({
		title: "How stage payments work",
		description: "d",
		path: "/articles/x",
		origin: ORIGIN,
		noindex: true,
		ogType: "article",
		ogImage: { src: "/test_images/banner_1.jpg", alt: "A workspace", width: 643, height: 360 },
		publishedAt: "2026-10-01",
		modifiedAt: "2026-10-17",
	});
	assertEquals(meta.robots, "noindex, follow");
	assertEquals(meta.og.image, {
		url: "https://projective.app/test_images/banner_1.jpg",
		alt: "A workspace",
		width: 643,
		height: 360,
	});
	assertEquals([meta.og.type, meta.og.publishedAt, meta.og.modifiedAt], [
		"article",
		"2026-10-01",
		"2026-10-17",
	]);
	assertEquals(meta.twitterCard, "summary_large_image");
});

Deno.test("applyPageMeta fills the state _app reads", () => {
	const state: { title?: string; description?: string; meta?: PageMeta } = {};
	const meta = pageMeta({ title: "Help", description: "Answers.", path: "/help", origin: ORIGIN });
	applyPageMeta(state, meta);
	assertEquals(state, { title: "Help · Projective", description: "Answers.", meta });
});

Deno.test("pageMeta: a content image is taken as is; alternates are made absolute", () => {
	const meta = pageMeta({
		title: "Changelog",
		description: "d",
		path: "/changelog",
		origin: ORIGIN,
		ogImage: SAMPLE_DOC.cover,
		alternates: [
			{ type: "application/rss+xml", href: "/changelog/rss.xml", title: "Projective changelog" },
			{ type: "application/feed+json", href: "https://cdn.example/feed.json" },
		],
	});
	assertEquals(meta.og.image, {
		url: "https://projective.app/test_images/banner_1.jpg",
		alt: SAMPLE_DOC.cover.alt,
		width: 643,
		height: 360,
	});
	assertEquals(meta.alternates, [
		{
			type: "application/rss+xml",
			href: "https://projective.app/changelog/rss.xml",
			title: "Projective changelog",
		},
		{ type: "application/feed+json", href: "https://cdn.example/feed.json" },
	]);
	assertEquals(
		pageMeta({ title: "T", description: "d", path: "/", origin: ORIGIN }).alternates,
		[],
	);
	assertEquals(metaImage("/a.png"), { src: "/a.png", alt: "" });
});
// #endregion

// #region JSON-LD
/** Every node carries a schema.org type, and every `@id` is an absolute URL with a fragment. */
function assertNode(node: JsonLdNode, type: string): void {
	assertEquals(node["@type"], type);
	if (node["@id"]) assert(/^https:\/\/[^#]+#[a-z]+$/.test(node["@id"]), String(node["@id"]));
}

Deno.test("serializeJsonLd cannot break out of its script element", () => {
	const separators = String.fromCharCode(0x2028, 0x2029);
	const hostile = `</script><script>alert(1)</script> & ${separators}`;
	const json = serializeJsonLd({ name: hostile });
	for (const ch of ["<", ">", "&", ...separators]) {
		assertFalse(json.includes(ch), `raw ${ch.codePointAt(0)}`);
	}
	assertEquals(JSON.parse(json).name, hostile);
});

Deno.test("jsonLdGraph: one context, nodes in order, falsy entries dropped", () => {
	const graph = jsonLdGraph(organizationJsonLd(ORIGIN), null, false, webSiteJsonLd(ORIGIN));
	assertEquals(graph["@context"], "https://schema.org");
	assertEquals(graph["@graph"].map((n) => n["@type"]), ["Organization", "WebSite"]);
});

Deno.test("Organization and WebSite: the publisher every node points at", () => {
	const org = organizationJsonLd(ORIGIN);
	assertNode(org, "Organization");
	assertEquals(org["@id"], "https://projective.app/#org");
	assertEquals((org.logo as { url: string }).url, "https://projective.app/icon-512.png");
	const site = webSiteJsonLd(ORIGIN);
	assertNode(site, "WebSite");
	assertEquals(site.publisher, { "@id": "https://projective.app/#org" });
});

Deno.test("WebPage and its About / Contact / Collection kinds", () => {
	const input = {
		origin: ORIGIN,
		path: "/about/",
		name: "About",
		description: "Who we are",
		breadcrumb: true,
	};
	const page = webPageJsonLd(input);
	assertNode(page, "WebPage");
	assertEquals(page.url, "https://projective.app/about");
	assertEquals(page.isPartOf, { "@id": "https://projective.app/#site" });
	assertEquals(page.breadcrumb, { "@id": "https://projective.app/about#breadcrumb" });
	assertNode(aboutPageJsonLd(input), "AboutPage");
	assertNode(contactPageJsonLd({ ...input, path: "/contact" }), "ContactPage");
	const hub = collectionPageJsonLd({
		origin: ORIGIN,
		path: "/legal",
		name: "Legal",
		description: "Policies",
		items: [{ name: "Terms", path: "/legal/terms" }, { name: "Privacy", path: "/legal/privacy" }],
	});
	assertNode(hub, "CollectionPage");
	const list = hub.mainEntity as {
		"@type": string;
		itemListElement: Array<{ position: number; url: string }>;
	};
	assertEquals(list["@type"], "ItemList");
	assertEquals(list.itemListElement.map((i) => [i.position, i.url]), [
		[1, "https://projective.app/legal/terms"],
		[2, "https://projective.app/legal/privacy"],
	]);
});

Deno.test("BreadcrumbList: positions from 1, absolute items, id on the page it belongs to", () => {
	const crumbs = breadcrumbListJsonLd(ORIGIN, [
		{ name: "Help", path: "/help" },
		{ name: "Payments", path: "/help/payments" },
	]);
	assertNode(crumbs, "BreadcrumbList");
	assertEquals(crumbs["@id"], "https://projective.app/help/payments#breadcrumb");
	assertEquals(crumbs.itemListElement, [
		{ "@type": "ListItem", position: 1, name: "Help", item: "https://projective.app/help" },
		{
			"@type": "ListItem",
			position: 2,
			name: "Payments",
			item: "https://projective.app/help/payments",
		},
	]);
});

Deno.test("Article / TechArticle: required properties, platform author by default", () => {
	const input = {
		origin: ORIGIN,
		path: "/articles/stage-payments",
		headline: SAMPLE_DOC.title,
		description: SAMPLE_DOC.summary,
		datePublished: "2026-10-01",
		image: SAMPLE_DOC.cover.src,
	};
	const article = articleJsonLd(input);
	assertNode(article, "Article");
	for (
		const key of [
			"headline",
			"description",
			"url",
			"datePublished",
			"dateModified",
			"author",
			"publisher",
			"image",
		]
	) {
		assert(key in article, key);
	}
	assertEquals(article.dateModified, "2026-10-01");
	assertEquals(article.author, { "@id": "https://projective.app/#org" });
	assertEquals(article.image, "https://projective.app/test_images/banner_1.jpg");
	assertEquals(article.mainEntityOfPage, {
		"@id": "https://projective.app/articles/stage-payments#webpage",
	});

	const tech = techArticleJsonLd({
		...input,
		authors: [{ name: SAMPLE_DOC.author.name, url: "/about" }],
	});
	assertNode(tech, "TechArticle");
	assertEquals(tech.author, {
		"@type": "Person",
		name: "Projective Editorial",
		url: "https://projective.app/about",
	});

	const long = articleJsonLd({ ...input, headline: "x".repeat(200) });
	assert((long.headline as string).length <= 110);
});

Deno.test("Article: a content cover becomes an ImageObject; content authors map; version and about", () => {
	const release = techArticleJsonLd({
		origin: ORIGIN,
		path: "/changelog/1-4-0",
		headline: "Projective 1.4.0",
		description: "What shipped.",
		datePublished: "2026-10-17",
		image: SAMPLE_DOC.cover,
		authors: [jsonLdAuthor(SAMPLE_DOC.author)],
		version: "1.4.0",
		about: { "@type": "SoftwareApplication", name: "Projective", softwareVersion: "1.4.0" },
	});
	assertEquals(release.image, {
		"@type": "ImageObject",
		url: "https://projective.app/test_images/banner_1.jpg",
		width: 643,
		height: 360,
	});
	assertEquals(release.author, {
		"@type": "Person",
		name: "Projective Editorial",
		url: "https://projective.app/about",
	});
	assertEquals(release.version, "1.4.0");
	assertEquals(release.about, {
		"@type": "SoftwareApplication",
		name: "Projective",
		softwareVersion: "1.4.0",
	});
	assertEquals(jsonLdAuthor({ name: "Team" }, "Organization"), {
		name: "Team",
		kind: "Organization",
	});
});

Deno.test("WebPage carries a document's version when given", () => {
	const page = webPageJsonLd({
		origin: ORIGIN,
		path: "/legal/terms",
		name: "Terms",
		description: "d",
		version: "2.1",
	});
	assertEquals(page.version, "2.1");
	assertFalse(
		"version" in webPageJsonLd({ origin: ORIGIN, path: "/x", name: "X", description: "d" }),
	);
});

Deno.test("FAQPage: every question carries one accepted answer, from content-module FAQ items", () => {
	const faq = faqPageJsonLd({
		origin: ORIGIN,
		path: "/help/payouts",
		items: faqJsonLdItems(SAMPLE_DOC.faq),
	});
	assertNode(faq, "FAQPage");
	const entities = faq.mainEntity as Array<
		{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }
	>;
	assertEquals(entities.length, SAMPLE_DOC.faq.length);
	for (const q of entities) {
		assertEquals(q["@type"], "Question");
		assertEquals(q.acceptedAnswer["@type"], "Answer");
		assert(q.acceptedAnswer.text.length > 0);
	}
	assertEquals(
		entities[1].acceptedAnswer.text,
		"Earned money clears a 7-day pending window before it reaches your available balance.",
	);
});
// #endregion
