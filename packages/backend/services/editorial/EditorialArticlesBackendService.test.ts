import { assert, assertEquals } from "@std/assert";
import { EditorialArticlesBackendService as Articles } from "./EditorialArticlesBackendService.ts";
import { ARTICLES_PAGE_SIZE } from "./articles-model.ts";

/**
 * EditorialArticlesBackendService on the fixture road (the content source through the same row parse
 * the live read uses), at fixed instants so the corpus's own dates drive every answer: newest first,
 * the any-of topic filter, the page bounds, the reader's 404s and related reading.
 */

const NOW = new Date("2026-10-17T12:00:00Z");
const fixture = { source: "fixture" as const, now: NOW };

Deno.test("index: every visible article, newest first, one page, with per-topic counts", async () => {
	const result = await Articles.index({ topics: [], page: 1 }, fixture);
	assert(result.ok && result.data);
	const index = result.data;
	assertEquals(index.items.map((item) => item.slug), [
		"ending-a-stage-early-fairly",
		"no-hold-no-work",
		"price-the-outcome-not-the-hour",
		"structuring-a-team-that-shares-fairly",
		"agile-delivery-in-stages",
		"asynchronous-collaboration-in-stages",
	]);
	assertEquals([index.page, index.pageCount, index.total, index.publishedTotal], [1, 1, 6, 6]);
	assertEquals(index.topicCounts["escrow-and-trust"], 2);
	assertEquals(index.topicCounts["agile-delivery"], 3);
	assert(
		index.items.every((item) =>
			item.readMinutes >= 3 && item.authorName === "Projective Editorial"
		),
	);
	assert(index.items.length <= ARTICLES_PAGE_SIZE);
});

Deno.test("index: the topic filter is any-of and canonicalised; counts stay unfiltered", async () => {
	const result = await Articles.index(
		{ topics: ["team-structure", "async-collaboration"], page: 1 },
		fixture,
	);
	assert(result.ok && result.data);
	assertEquals(result.data.topics, ["async-collaboration", "team-structure"]);
	assertEquals(result.data.items.map((item) => item.slug), [
		"structuring-a-team-that-shares-fairly",
		"agile-delivery-in-stages",
		"asynchronous-collaboration-in-stages",
	]);
	assertEquals(result.data.total, 3);
	assertEquals(result.data.publishedTotal, 6);
});

Deno.test("index: a page past the last is a 404; an empty result is page 1 of 1", async () => {
	const missing = await Articles.index({ topics: [], page: 2 }, fixture);
	assertEquals(missing.status, 404);
	const early = await Articles.index({ topics: ["escrow-and-trust"], page: 1 }, {
		source: "fixture",
		now: new Date("2026-09-01T00:00:00Z"),
	});
	assert(early.ok && early.data);
	assertEquals([early.data.items.length, early.data.page, early.data.pageCount, early.data.total], [
		0,
		1,
		1,
		0,
	]);
	assertEquals(early.data.publishedTotal, 1);
});

Deno.test("article: the reader's page — view, author and three related articles", async () => {
	const result = await Articles.article("no-hold-no-work", fixture);
	assert(result.ok && result.data);
	const { article, author, related } = result.data;
	assertEquals(article.title, "No hold, no work: how escrow protects both sides");
	assert(article.wordCount >= 700);
	assertEquals(article.readMinutes, Math.max(1, Math.round(article.wordCount / 230)));
	assertEquals(author.slug, "projective-editorial");
	assertEquals(related.length, 3);
	assertEquals(related[0].slug, "ending-a-stage-early-fairly");
	assert(related.every((card) => card.slug !== "no-hold-no-work"));
});

Deno.test("article: unknown, not-yet-published and malformed slugs are all a plain 404", async () => {
	assertEquals((await Articles.article("nothing-here", fixture)).status, 404);
	const beforePublication = await Articles.article("ending-a-stage-early-fairly", {
		source: "fixture",
		now: new Date("2026-10-13T00:00:00Z"),
	});
	assertEquals(beforePublication.status, 404);
	assertEquals((await Articles.article("No-Hold-No-Work", fixture)).status, 404);
});
