import { assert, assertEquals, assertFalse } from "@std/assert";
import {
	articleHref,
	articlesIndexHref,
	canonicalTopics,
	isArticleSlug,
	parseArticleIndexQuery,
	toggleTopicHref,
} from "./index-query.ts";

/**
 * The `/articles` URL contract (P6): `?topic=` repeatable and any-of, `?page=` 1-based, one canonical
 * spelling per state — the route 308s every other spelling to it.
 */

const parse = (search: string) => parseArticleIndexQuery(new URLSearchParams(search));

Deno.test("no query is page 1 of every topic, already canonical", () => {
	assertEquals(parse(""), { topics: [], page: 1, search: "", changed: false });
});

Deno.test("canonical topics and pages parse without a redirect", () => {
	assertEquals(parse("topic=agile-delivery&topic=value-pricing&page=2"), {
		topics: ["agile-delivery", "value-pricing"],
		page: 2,
		search: "?topic=agile-delivery&topic=value-pricing&page=2",
		changed: false,
	});
	// Parameter order is not a different state, so it is never redirected.
	assertFalse(parse("page=2&topic=agile-delivery").changed);
});

Deno.test("unknown, repeated and out-of-order topics are canonicalised and redirected", () => {
	const repeated = parse("topic=value-pricing&topic=agile-delivery&topic=value-pricing&topic=nope");
	assertEquals(repeated.topics, ["agile-delivery", "value-pricing"]);
	assertEquals(repeated.search, "?topic=agile-delivery&topic=value-pricing");
	assert(repeated.changed);
	assertEquals(canonicalTopics(["escrow-and-trust", "ESCROW-AND-TRUST", ""]), ["escrow-and-trust"]);
});

Deno.test("page=1, a malformed page and a repeated page redirect; other parameters survive", () => {
	for (
		const search of ["page=1", "page=0", "page=-2", "page=2.5", "page=abc", "page=02", "page=99999"]
	) {
		const parsed = parse(`${search}&utm_source=mail`);
		assertEquals(parsed.page, 1, search);
		assertEquals(parsed.search, "?utm_source=mail", search);
		assert(parsed.changed, search);
	}
	const twice = parse("page=2&page=3");
	assertEquals(twice.page, 2);
	assert(twice.changed);
	assertFalse(parse("utm_source=mail").changed);
});

Deno.test("links: the index, a topic toggled in and out (back to page 1), an article", () => {
	assertEquals(articlesIndexHref(), "/articles");
	assertEquals(articlesIndexHref({ page: 1 }), "/articles");
	assertEquals(
		articlesIndexHref({ topics: ["value-pricing", "agile-delivery"], page: 3 }),
		"/articles?topic=agile-delivery&topic=value-pricing&page=3",
	);
	assertEquals(toggleTopicHref([], "team-structure"), "/articles?topic=team-structure");
	assertEquals(
		toggleTopicHref(["team-structure"], "agile-delivery"),
		"/articles?topic=agile-delivery&topic=team-structure",
	);
	assertEquals(toggleTopicHref(["team-structure"], "team-structure"), "/articles");
	assertEquals(articleHref("no-hold-no-work"), "/articles/no-hold-no-work");
});

Deno.test("an article slug is readable lower-case kebab, at most 96 characters", () => {
	assert(isArticleSlug("no-hold-no-work"));
	assert(isArticleSlug("a1"));
	for (
		const bad of ["", "No-Hold", "no--hold", "-no", "no-", "no_hold", "no hold", "a".repeat(97)]
	) {
		assertFalse(isArticleSlug(bad), bad);
	}
});
