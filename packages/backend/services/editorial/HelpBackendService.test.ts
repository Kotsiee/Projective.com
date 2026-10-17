import { assert, assertEquals } from "@std/assert";
import type { SupabaseClient } from "supabaseClient";
import { HelpBackendService } from "./HelpBackendService.ts";
import { HELP_ARTICLE_CONTENT, HELP_ARTICLES, HELP_CATEGORY_CONTENT } from "./content/help.ts";

/**
 * HelpBackendService on both roads. The property worth defending: a live read of the seeded rows
 * and the fixture road organise and search to the same answers, and an article outside its
 * publication window is hidden on both.
 */

/** A client whose `.schema("editorial").from(table).select("*")` answers the given rows per table. */
function seededClient(rows: Record<string, unknown[]>, error?: { code: string; message: string }) {
	return {
		schema: () => ({
			from: (table: string) => ({
				select: () =>
					Promise.resolve(error ? { data: null, error } : { data: rows[table] ?? [], error: null }),
			}),
		}),
	} as unknown as SupabaseClient;
}

const seeded = {
	help_categories: HELP_CATEGORY_CONTENT.rows(),
	help_articles: HELP_ARTICLE_CONTENT.rows(),
};
const NOW = new Date("2026-10-20T12:00:00Z");

Deno.test("fixture road: every published article is organised into its topic", async () => {
	const result = await HelpBackendService.snapshot({ source: "fixture", now: NOW });
	assert(result.ok && result.data);
	assertEquals(result.data.source, "fixture");
	assertEquals(result.data.library.articles.length, HELP_ARTICLES.length);
	assertEquals(result.data.library.topics.length, 8);
});

Deno.test("live road: the seeded rows organise and search exactly as the fixture road", async () => {
	const live = await HelpBackendService.snapshot({
		source: "live",
		client: seededClient(seeded),
		now: NOW,
	});
	const fixture = await HelpBackendService.snapshot({ source: "fixture", now: NOW });
	assert(live.ok && live.data && fixture.ok && fixture.data);
	assertEquals(live.data.library.articles, fixture.data.library.articles);
	const q = "fund a stage";
	const a = await HelpBackendService.search(q, {
		source: "live",
		client: seededClient(seeded),
		now: NOW,
	});
	const b = await HelpBackendService.search(q, { source: "fixture", now: NOW });
	assertEquals(a.data, b.data);
	assertEquals(a.data?.results[0]?.slug, "how-stage-funding-works");
});

Deno.test("an article before its publication date, or archived, is hidden on both roads", async () => {
	const early = await HelpBackendService.snapshot({
		source: "fixture",
		now: new Date("2026-10-16T23:59:59Z"),
	});
	assertEquals(early.data?.library.articles.length, 0);
	assertEquals(early.data?.library.topics.length, 0);

	const archivedRows = seeded.help_articles.map((row, i) =>
		i === 0 ? { ...row, archived_on: "2026-10-18" } : row
	);
	const live = await HelpBackendService.snapshot({
		source: "live",
		client: seededClient({ ...seeded, help_articles: archivedRows }),
		now: NOW,
	});
	assertEquals(live.data?.library.articles.length, HELP_ARTICLES.length - 1);
	assertEquals(live.data?.library.article(String(seeded.help_articles[0].slug)), null);
});

Deno.test("an unexposed schema is a 503, a drifted row a 500 — never a half-built centre", async () => {
	const down = await HelpBackendService.snapshot({
		source: "live",
		client: seededClient({}, { code: "PGRST106", message: "not exposed" }),
		now: NOW,
	});
	assertEquals(down.status, 503);
	const drifted = await HelpBackendService.snapshot({
		source: "live",
		client: seededClient({ ...seeded, help_articles: [{ slug: "x" }] }),
		now: NOW,
	});
	assertEquals(drifted.status, 500);
});

Deno.test("search: an empty query answers no results; the query is echoed", async () => {
	const empty = await HelpBackendService.search("", { source: "fixture", now: NOW });
	assertEquals(empty.data, { query: "", results: [] });
	const hit = await HelpBackendService.search("escrow", { source: "fixture", now: NOW });
	assertEquals(hit.data?.query, "escrow");
	assertEquals(hit.data?.results[0]?.href, "/help/escrow-and-payments/what-is-escrow");
});

Deno.test("the default read is cached until cleared", async () => {
	HelpBackendService.clearCache();
	const first = await HelpBackendService.snapshot({ source: "fixture" });
	const second = await HelpBackendService.snapshot({ source: "fixture" });
	assert(first.data && second.data);
	assert(first.data === second.data, "the second read should be the cached snapshot");
	HelpBackendService.clearCache();
	const third = await HelpBackendService.snapshot({ source: "fixture" });
	assert(third.data !== first.data);
	HelpBackendService.clearCache();
});
