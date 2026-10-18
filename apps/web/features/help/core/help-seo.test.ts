import { assert, assertEquals } from "@std/assert";
import { buildHelpLibrary } from "@server/services/editorial/help-library.ts";
import { HELP_ARTICLES, HELP_CATEGORIES } from "@server/services/editorial/content/help.ts";
import { serializeJsonLd } from "@features/marketing/core/seo.ts";
import { articleSeo, categorySeo, hubSeo } from "./help-seo.ts";

/** Each help page's head and schema.org graph (P2 §5). */

const ORIGIN = "https://projective.example";
const library = buildHelpLibrary(HELP_CATEGORIES, HELP_ARTICLES);
const types = (graph: { "@graph": Array<{ "@type": string }> }) =>
	graph["@graph"].map((n) => n["@type"]);

/** Every `@id` a node points at must be a node of the same graph. */
function assertNoDanglingIds(graph: { "@graph": Array<Record<string, unknown>> }) {
	const ids = new Set(graph["@graph"].map((n) => n["@id"]).filter(Boolean));
	const refs: string[] = [];
	const walk = (v: unknown, top: boolean) => {
		if (Array.isArray(v)) v.forEach((x) => walk(x, false));
		else if (v && typeof v === "object") {
			const o = v as Record<string, unknown>;
			if (!top && typeof o["@id"] === "string" && Object.keys(o).length === 1) refs.push(o["@id"]);
			for (const [k, x] of Object.entries(o)) if (k !== "@id") walk(x, false);
		}
	};
	graph["@graph"].forEach((n) => walk(n, true));
	for (const ref of refs) assert(ids.has(ref), `dangling ${ref}`);
}

Deno.test("hub: a CollectionPage of the topics and an FAQPage of the eight questions", () => {
	const { meta, graph } = hubSeo(library, ORIGIN, false);
	assertEquals(meta.canonical, `${ORIGIN}/help`);
	assertEquals(meta.robots, "index, follow");
	assertEquals(types(graph), ["Organization", "WebSite", "CollectionPage", "FAQPage"]);
	const faq = graph["@graph"][3] as unknown as { mainEntity: Array<{ name: string }> };
	assertEquals(faq.mainEntity.length, 8);
	assertNoDanglingIds(graph);
	JSON.parse(serializeJsonLd(graph));
});

Deno.test("a page showing search results is noindex, canonical to itself", () => {
	const { meta } = hubSeo(library, ORIGIN, true);
	assertEquals(meta.robots, "noindex, follow");
	assertEquals(meta.canonical, `${ORIGIN}/help`);
});

Deno.test("category: a CollectionPage of its articles and its trail", () => {
	const topic = library.topic("escrow-and-payments")!;
	const { meta, graph } = categorySeo(topic, ORIGIN, false);
	assertEquals(meta.canonical, `${ORIGIN}/help/escrow-and-payments`);
	assertEquals(types(graph), ["Organization", "WebSite", "CollectionPage", "BreadcrumbList"]);
	const crumbs = graph["@graph"][3] as unknown as { itemListElement: Array<{ name: string }> };
	assertEquals(crumbs.itemListElement.map((c) => c.name), ["Help centre", "Escrow & payments"]);
	assertNoDanglingIds(graph);
});

Deno.test("article: a TechArticle in its category's section, its WebPage and a three-step trail", () => {
	const article = library.article("how-stage-funding-works")!;
	const category = library.categoryOf(article)!;
	const { meta, graph } = articleSeo(article, category, ORIGIN, false);
	assertEquals(meta.canonical, `${ORIGIN}/help/escrow-and-payments/how-stage-funding-works`);
	assertEquals(meta.og.type, "article");
	assertEquals(types(graph), [
		"Organization",
		"WebSite",
		"WebPage",
		"TechArticle",
		"BreadcrumbList",
	]);
	const tech = graph["@graph"][3] as Record<string, unknown>;
	assertEquals(tech.headline, article.title);
	assertEquals(tech.articleSection, "Escrow & payments");
	assertEquals(tech.dateModified, article.updatedAt);
	assert(typeof tech.wordCount === "number" && (tech.wordCount as number) > 100);
	assertNoDanglingIds(graph);
});
