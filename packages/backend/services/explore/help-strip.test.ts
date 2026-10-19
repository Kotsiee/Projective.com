import { assert, assertEquals } from "@std/assert";
import type { HelpCentreArticle, HelpCentreCategory } from "@projective/types/editorial";
import { buildHelpLibrary } from "../editorial/help-library.ts";
import { HELP_ARTICLES, HELP_CATEGORIES } from "../editorial/content/help.ts";
import { HELP_STRIP_SIZE, helpStripFrom } from "./help-strip.ts";

/** Explore Home's editorial break, read from the help centre (Decision #295, closing #279 (h)). */

function category(slug: string, position: number): HelpCentreCategory {
	return { slug, position, title: slug, description: `About ${slug}.`, icon: "flag" };
}

function article(slug: string, cat: string, position: number): HelpCentreArticle {
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
	};
}

Deno.test("the strip lists the hub's opening topic, in reading order, and links each to its help page", () => {
	const library = buildHelpLibrary(
		[category("payments", 1), category("start", 0)],
		[
			article("start-d", "start", 3),
			article("pay-a", "payments", 0),
			article("start-b", "start", 1),
			article("start-a", "start", 0),
			article("start-c", "start", 2),
		],
	);
	const strip = helpStripFrom(library);
	assert(strip);
	assertEquals(strip.href, "/help");
	assertEquals(strip.hrefLabel, "All help articles");
	assertEquals(strip.articles.length, HELP_STRIP_SIZE);
	assertEquals(strip.articles.map((a) => a.href), [
		"/help/start/start-a",
		"/help/start/start-b",
		"/help/start/start-c",
	]);
	assertEquals(strip.articles[0], {
		id: "start-a",
		title: "Title start-a",
		minutes: 1,
		href: "/help/start/start-a",
	});
});

Deno.test("no help centre, or one with nothing to read, means no strip rather than an empty one", () => {
	assertEquals(helpStripFrom(null), null);
	assertEquals(helpStripFrom(buildHelpLibrary([category("start", 0)], [])), null);
});

Deno.test("on the shipped help content the strip starts with Getting started — no member post, no /view link", () => {
	const strip = helpStripFrom(buildHelpLibrary(HELP_CATEGORIES, HELP_ARTICLES));
	assert(strip);
	assert(strip.articles.length > 0);
	for (const read of strip.articles) {
		assert(read.href.startsWith("/help/getting-started/"), read.href);
		assert(read.minutes >= 1);
	}
});
