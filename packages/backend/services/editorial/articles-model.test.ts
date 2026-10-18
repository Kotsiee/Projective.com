import { assert, assertEquals, assertThrows } from "@std/assert";
import type { EditorialArticleRecord, EditorialArticleTopic } from "@projective/types/editorial";
import {
	ARTICLE_WORDS_PER_MINUTE,
	articleReadMinutes,
	articleWordCount,
	compareNewestFirst,
	countTopics,
	filterByTopics,
	paginate,
	relatedArticles,
	toArticleCard,
	toArticleView,
} from "./articles-model.ts";

/**
 * articles-model — the pure rules of Projective's article index and reader (P6): reading time from
 * the word count, newest-first order, the any-of topic filter, pagination and related reading.
 */

// #region Fixtures
function record(
	slug: string,
	publishedAt: string,
	topics: EditorialArticleTopic[],
	words = 10,
): EditorialArticleRecord {
	return {
		slug,
		title: "Title",
		standfirst: "Stand",
		topics,
		sections: [{
			id: "s",
			heading: "Heading",
			body: [{ type: "p", content: Array.from({ length: words }, () => "word").join(" ") }],
		}],
		cover: { src: "/c.jpg", alt: "Cover", w: 16, h: 10 },
		authorSlug: "a",
		status: "published",
		publishedAt,
		updatedAt: publishedAt,
	};
}
// #endregion

// #region Reading time
Deno.test("word count reads the title, standfirst, headings, summary lines and every body node", () => {
	const article = record("a", "2026-10-01T00:00:00.000Z", ["agile-delivery"], 0);
	article.title = "Three word title";
	article.standfirst = "Two words";
	article.sections = [{
		id: "one",
		heading: "First heading",
		tldr: ["In ", { type: "strong", text: "short" }],
		body: [
			{ type: "p", content: "One two three." },
			{
				type: "list",
				items: ["four", { content: "five six", list: { type: "list", items: ["seven"] } }],
			},
			{ type: "h3", text: "Eight" },
			{ type: "quote", content: "nine", cite: "Ten" },
			{ type: "table", head: ["eleven"], rows: [["twelve"]] },
			{ type: "dl", items: [{ term: "thirteen", definition: "fourteen" }] },
			{ type: "callout", tone: "tip", body: [{ type: "p", content: "fifteen sixteen" }] },
			{ type: "image", src: "/i.png", alt: "Alt words", w: 1, h: 1, caption: "seventeen" },
			{ type: "code", text: "eighteen()" },
		],
	}];
	// 3 + 2 + 2 (heading) + 2 (tldr) + 3 + 4 (list) + 1 + 2 (quote + cite) + 2 (table) + 2 (dl)
	// + 2 (callout) + 1 (caption, not alt) + 1 (code)
	assertEquals(articleWordCount(article), 27);
});

Deno.test("reading time rounds to whole minutes at 230 wpm and is never under one minute", () => {
	assertEquals(ARTICLE_WORDS_PER_MINUTE, 230);
	assertEquals(articleReadMinutes(0), 1);
	assertEquals(articleReadMinutes(1), 1);
	assertEquals(articleReadMinutes(344), 1);
	assertEquals(articleReadMinutes(345), 2);
	assertEquals(articleReadMinutes(2300), 10);
	assertEquals(articleReadMinutes(1000, 100), 10);
	assertEquals(articleReadMinutes(Number.NaN), 1);
	assertEquals(articleReadMinutes(-5), 1);
});

Deno.test("a tile carries the computed reading time; the view adds the word count and sections", () => {
	const article = record("a", "2026-10-01T00:00:00.000Z", ["agile-delivery"], 920);
	const card = toArticleCard(article, "Projective Editorial");
	const words = articleWordCount(article);
	assertEquals(card.readMinutes, articleReadMinutes(words));
	assertEquals(card.authorName, "Projective Editorial");
	assert(!("sections" in card));
	const view = toArticleView(article, "Projective Editorial");
	assertEquals(view.wordCount, words);
	assertEquals(view.readMinutes, card.readMinutes);
	assertEquals(view.sections, article.sections);
});
// #endregion

// #region Ordering, filter, pages
Deno.test("newest first, ties broken by slug, across timestamp spellings", () => {
	const items = [
		record("b", "2026-10-01T08:00:00Z", ["agile-delivery"]),
		record("a", "2026-10-01T08:00:00.000Z", ["agile-delivery"]),
		record("c", "2026-10-02T00:00:00+00:00", ["agile-delivery"]),
		record("d", "2026-09-30T23:59:59Z", ["agile-delivery"]),
	];
	assertEquals([...items].sort(compareNewestFirst).map((item) => item.slug), ["c", "a", "b", "d"]);
});

Deno.test("the topic filter is any-of, keeps order, and an empty filter keeps everything", () => {
	const items = [
		record("a", "2026-10-03T00:00:00Z", ["agile-delivery", "value-pricing"]),
		record("b", "2026-10-02T00:00:00Z", ["team-structure"]),
		record("c", "2026-10-01T00:00:00Z", ["value-pricing"]),
	];
	assertEquals(filterByTopics(items, []).map((i) => i.slug), ["a", "b", "c"]);
	assertEquals(filterByTopics(items, ["value-pricing"]).map((i) => i.slug), ["a", "c"]);
	assertEquals(filterByTopics(items, ["team-structure", "agile-delivery"]).map((i) => i.slug), [
		"a",
		"b",
	]);
	assertEquals(filterByTopics(items, ["escrow-and-trust"]), []);
});

Deno.test("topic counts name every topic, count an article once per topic, and start at zero", () => {
	const counts = countTopics([
		{ topics: ["agile-delivery", "value-pricing"] },
		{ topics: ["agile-delivery"] },
	]);
	assertEquals(counts, {
		"async-collaboration": 0,
		"agile-delivery": 2,
		"team-structure": 0,
		"value-pricing": 1,
		"escrow-and-trust": 0,
	});
});

Deno.test("pagination: slices, counts pages, gives an empty list one page, refuses out-of-range", () => {
	const items = Array.from({ length: 25 }, (_, i) => i);
	assertEquals(paginate(items, 1, 12), {
		items: items.slice(0, 12),
		page: 1,
		pageCount: 3,
		total: 25,
	});
	assertEquals(paginate(items, 3, 12)?.items, [24]);
	assertEquals(paginate(items, 4, 12), null);
	assertEquals(paginate(items, 0, 12), null);
	assertEquals(paginate(items, 1.5, 12), null);
	assertEquals(paginate([], 1, 12), { items: [], page: 1, pageCount: 1, total: 0 });
	assertEquals(paginate([], 2, 12), null);
	assertEquals(paginate(items.slice(0, 12), 1, 12)?.pageCount, 1);
	assertThrows(() => paginate(items, 1, 0), RangeError);
});
// #endregion

// #region Related
Deno.test("related reading: most shared topics, then the primary topic, then newest; never itself", () => {
	const self = record("self", "2026-10-10T00:00:00Z", ["escrow-and-trust", "value-pricing"]);
	const pool = [
		self,
		record("both", "2026-09-01T00:00:00Z", ["value-pricing", "escrow-and-trust"]),
		record("secondary-new", "2026-10-09T00:00:00Z", ["value-pricing"]),
		record("primary-old", "2026-08-01T00:00:00Z", ["escrow-and-trust"]),
		record("unrelated-newest", "2026-10-11T00:00:00Z", ["team-structure"]),
	];
	assertEquals(relatedArticles(self, pool).map((a) => a.slug), [
		"both",
		"primary-old",
		"secondary-new",
	]);
	assertEquals(relatedArticles(self, pool, 1).map((a) => a.slug), ["both"]);
	assertEquals(relatedArticles(self, pool, 0), []);
});

Deno.test("related reading tops up with the newest others when too few share a topic", () => {
	const self = record("self", "2026-10-10T00:00:00Z", ["team-structure"]);
	const pool = [
		record("shares", "2026-01-01T00:00:00Z", ["team-structure"]),
		record("newest", "2026-10-09T00:00:00Z", ["agile-delivery"]),
		record("older", "2026-09-09T00:00:00Z", ["agile-delivery"]),
		record("oldest", "2026-08-09T00:00:00Z", ["agile-delivery"]),
		self,
	];
	assertEquals(relatedArticles(self, pool).map((a) => a.slug), ["shares", "newest", "older"]);
	assertEquals(relatedArticles(self, [self]), []);
});
// #endregion
