import { assertEquals } from "@std/assert";
import type { HelpCentreArticle, HelpCentreCategory } from "@projective/types/editorial";
import { buildHelpLibrary, HELP_ROOT, helpArticlePath, helpCategoryPath } from "./help-library.ts";

/** The help library's ordering rules, on small synthetic records. */

function category(slug: string, position: number): HelpCentreCategory {
	return { slug, position, title: slug.toUpperCase(), description: `About ${slug}.`, icon: "flag" };
}

function article(
	slug: string,
	cat: string,
	position: number,
	extra: Partial<HelpCentreArticle> = {},
): HelpCentreArticle {
	return {
		id: slug,
		slug,
		title: `Title ${slug}`,
		summary: `Summary ${slug}.`,
		updatedAt: "2026-10-17",
		version: "2026-10-17",
		sections: [{ id: "one", heading: "One", body: [{ type: "p", content: "Body." }] }],
		category: cat,
		position,
		roles: ["client"],
		startHere: [],
		related: [],
		faq: null,
		publishedOn: "2026-10-17",
		archivedOn: null,
		...extra,
	};
}

const categories = [category("payments", 1), category("start", 0), category("empty", 2)];
const articles = [
	article("pay-b", "payments", 1, { startHere: ["client"], faq: { rank: 2, question: "B?" } }),
	article("start-a", "start", 0, { related: ["pay-b", "missing", "start-a"] }),
	article("pay-a", "payments", 0, { startHere: ["client"], faq: { rank: 1, question: "A?" } }),
	article("orphan", "nowhere", 0),
];
const library = buildHelpLibrary(categories, articles);

Deno.test("topics follow category position, skip an empty category, and order their articles", () => {
	assertEquals(
		library.topics.map((t) => [t.category.slug, t.articles.map((a) => a.slug)]),
		[["start", ["start-a"]], ["payments", ["pay-a", "pay-b"]]],
	);
	assertEquals(library.topic("empty"), null);
});

Deno.test("reading order spans categories, and an article with no category is left out", () => {
	assertEquals(library.articles.map((a) => a.slug), ["start-a", "pay-a", "pay-b"]);
	assertEquals(library.article("orphan"), null);
	assertEquals(library.article("pay-a")?.slug, "pay-a");
});

Deno.test("neighbours stay inside the category", () => {
	const payA = library.article("pay-a")!;
	const payB = library.article("pay-b")!;
	assertEquals(library.neighbours(payA).previous, null);
	assertEquals(library.neighbours(payA).next?.slug, "pay-b");
	assertEquals(library.neighbours(payB).previous?.slug, "pay-a");
	assertEquals(library.neighbours(library.article("start-a")!).next, null);
});

Deno.test("related keeps the authored order and drops missing articles and itself", () => {
	assertEquals(library.related(library.article("start-a")!).map((a) => a.slug), ["pay-b"]);
});

Deno.test("a role's start-here column and the FAQ", () => {
	assertEquals(library.startHere("client").map((a) => a.slug), ["pay-a", "pay-b"]);
	assertEquals(library.startHere("team"), []);
	assertEquals(library.faq().map((a) => a.slug), ["pay-a", "pay-b"]);
});

Deno.test("addresses", () => {
	assertEquals(HELP_ROOT, "/help");
	assertEquals(helpCategoryPath("payments"), "/help/payments");
	assertEquals(helpArticlePath({ category: "payments", slug: "pay-a" }), "/help/payments/pay-a");
});
