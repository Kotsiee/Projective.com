import { assert, assertEquals, assertFalse } from "@std/assert";
import type { SupabaseClient } from "supabaseClient";
import type {
	ContentImage,
	ContentNode,
	DocSection,
	InlineContent,
} from "@projective/types/content";
import {
	EDITORIAL_ARTICLE_TOPICS,
	EditorialArticleAuthorRowSchema,
	type EditorialArticleRecord,
	EditorialArticleRowSchema,
} from "@projective/types/editorial";
import { rowsFromRecords } from "../../../core/row-mapper.ts";
import { readEditorialTable } from "../editorial-source.ts";
import { articleWordCount, formerSlugProblems } from "../articles-model.ts";
import {
	ARTICLE_AUTHORS,
	ARTICLE_AUTHORS_TABLE,
	ARTICLES,
	ARTICLES_CONTENT,
	ARTICLES_TABLE,
	isEditorialArticleVisible,
} from "./articles.ts";
import { placeholderFigure } from "./articles/covers.ts";

/**
 * The articles content source (P6, Decision #271): every record is a row the database accepts, the
 * corpus is real (at least six published, substantive articles across all five topics), every link
 * and picture it names resolves, and the live road maps PostgREST's rows to exactly the records the
 * fixture road serves.
 */

const STATIC = new URL("../../../../../apps/web/static/", import.meta.url);
const articles = ARTICLES.records;
const slugs = new Set(articles.map((article) => article.slug));

// #region Walking the bodies
/** Every inline content value in a node, nested lists and callouts included. */
function inlineOf(node: ContentNode): InlineContent[] {
	switch (node.type) {
		case "p":
		case "quote":
			return [node.content];
		case "list":
			return node.items.flatMap((item) =>
				typeof item === "string"
					? [item]
					: [item.content, ...(item.list ? inlineOf(item.list) : [])]
			);
		case "callout":
			return node.body.flatMap(inlineOf);
		case "table":
			return [...node.head, ...node.rows.flat()];
		case "dl":
			return node.items.map((item) => item.definition);
		default:
			return [];
	}
}

/** Every link href in a set of sections. */
function hrefsOf(sections: readonly DocSection[]): string[] {
	return sections.flatMap((section) =>
		section.body.flatMap(inlineOf).flatMap((content) =>
			typeof content === "string"
				? []
				: content.flatMap((run) => typeof run !== "string" && run.type === "link" ? [run.href] : [])
		)
	);
}

/** A little-endian unsigned integer of `length` bytes at `at`. */
function uintLE(bytes: Uint8Array, at: number, length: number): number {
	let value = 0;
	for (let i = length - 1; i >= 0; i--) value = value * 256 + bytes[at + i];
	return value;
}

/** Intrinsic size of a WebP (its VP8X, VP8L or VP8 header). */
function webpSize(bytes: Uint8Array, path: string): { w: number; h: number } {
	const chunk = new TextDecoder().decode(bytes.subarray(12, 16));
	if (chunk === "VP8X") return { w: uintLE(bytes, 24, 3) + 1, h: uintLE(bytes, 27, 3) + 1 };
	if (chunk === "VP8L") {
		const bits = uintLE(bytes, 21, 4);
		return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
	}
	if (chunk === "VP8 ") {
		return { w: uintLE(bytes, 26, 2) & 0x3fff, h: uintLE(bytes, 28, 2) & 0x3fff };
	}
	throw new Error(`${path}: unknown WebP chunk ${chunk}`);
}

/** Intrinsic size of a JPEG (its first SOF marker), a WebP or an SVG (its width/height attributes). */
async function intrinsicSize(path: string): Promise<{ w: number; h: number }> {
	const bytes = await Deno.readFile(new URL(path.replace(/^\//, ""), STATIC));
	if (path.endsWith(".svg")) {
		const text = new TextDecoder().decode(bytes);
		const w = Number(/<svg[^>]*\swidth="(\d+)"/.exec(text)?.[1]);
		const h = Number(/<svg[^>]*\sheight="(\d+)"/.exec(text)?.[1]);
		return { w, h };
	}
	if (path.endsWith(".webp")) return webpSize(bytes, path);
	let i = 2;
	while (i < bytes.length) {
		if (bytes[i] !== 0xff) {
			i++;
			continue;
		}
		const marker = bytes[i + 1];
		const length = (bytes[i + 2] << 8) | bytes[i + 3];
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
		}
		i += 2 + length;
	}
	throw new Error(`${path}: no size marker found`);
}
// #endregion

// #region The corpus
Deno.test("every author and article is a row the database accepts (toRow + the Zod row parse)", () => {
	assertEquals(rowsFromRecords(ARTICLE_AUTHORS_TABLE, ARTICLE_AUTHORS.records).length, 1);
	assertEquals(rowsFromRecords(ARTICLES_TABLE, articles).length, articles.length);
	assertEquals(ARTICLES_CONTENT.tables.map((t) => t.table.table), [
		"editorial.article_authors",
		"editorial.articles",
	]);
});

Deno.test("the row schemas refuse every value the probe shows the CHECKs refusing", () => {
	const [article] = rowsFromRecords(ARTICLES_TABLE, articles);
	const [author] = rowsFromRecords(ARTICLE_AUTHORS_TABLE, ARTICLE_AUTHORS.records);
	assert(EditorialArticleRowSchema.safeParse(article).success);
	assert(EditorialArticleAuthorRowSchema.safeParse(author).success);
	const published = article.published_at as string;
	const before = new Date(Date.parse(published) - 86_400_000).toISOString();
	const articleCases: Array<[string, Record<string, unknown>]> = [
		["slug with a capital", { slug: "Bad-Slug" }],
		["97-character slug", { slug: "a".repeat(97) }],
		["blank title", { title: "   " }],
		["blank standfirst", { standfirst: " " }],
		["unknown topic", { topics: ["marketing"] }],
		["empty topics", { topics: [] }],
		["NULL topic", { topics: ["agile-delivery", null] }],
		["four topics", {
			topics: ["agile-delivery", "value-pricing", "team-structure", "escrow-and-trust"],
		}],
		["empty body", { body: [] }],
		["object body", { body: { id: "a" } }],
		["protocol-relative cover", { cover_path: "//evil.example/c.jpg" }],
		["loopback http cover", { cover_path: "http://127.0.0.1/c.jpg" }],
		["blank cover alt", { cover_alt: "  " }],
		["zero-width cover", { cover_w: 0 }],
		["unknown status", { status: "live" }],
		["updated before published", { updated_at: before }],
		["own slug as a former one", { former_slugs: [article.slug] }],
		["malformed former slug", { former_slugs: ["old-name", "Old_Name"] }],
		["97-character former slug", { former_slugs: ["b".repeat(97)] }],
		["NULL former slug", { former_slugs: ["old-name", null] }],
		["empty former slug", { former_slugs: ["old-name", ""] }],
		["lone empty former slug", { former_slugs: [""] }],
		["former slug holding a space", { former_slugs: ["old name"] }],
		["former slugs hiding an empty one", { former_slugs: ["", "old-name"] }],
		["seventeen former slugs", {
			former_slugs: Array.from({ length: 17 }, (_, i) => `old-${i + 1}`),
		}],
	];
	for (const [label, change] of articleCases) {
		assertFalse(EditorialArticleRowSchema.safeParse({ ...article, ...change }).success, label);
	}
	assert(
		EditorialArticleRowSchema.safeParse({ ...article, former_slugs: ["old-name", "c".repeat(96)] })
			.success,
		"well-formed former slugs parse",
	);
	const authorCases: Array<[string, Record<string, unknown>]> = [
		["unknown kind", { kind: "robot" }],
		["off-site profile link", { profile_href: "https://elsewhere.example/me" }],
		["protocol-relative profile link", { profile_href: "//elsewhere.example/me" }],
		["blank name", { name: "  " }],
		["blank role", { role: "   " }],
		["blank bio", { bio: " " }],
		["loopback http avatar", { avatar_path: "http://localhost/a.png" }],
		["blank avatar alt", { avatar_alt: " " }],
		["97-character slug", { slug: "d".repeat(97) }],
	];
	for (const [label, change] of authorCases) {
		assertFalse(EditorialArticleAuthorRowSchema.safeParse({ ...author, ...change }).success, label);
	}
	assert(
		EditorialArticleAuthorRowSchema.safeParse({ ...author, profile_href: "/@editorial" }).success,
	);
});

Deno.test("at least six articles are published and visible now, each with a unique readable slug", () => {
	const now = new Date();
	const visible = articles.filter((article) => isEditorialArticleVisible(article, now));
	assert(visible.length >= 6, `only ${visible.length} visible articles`);
	assertEquals(slugs.size, articles.length);
	for (const article of articles) {
		assert(
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) && article.slug.length <= 96,
			article.slug,
		);
		assert(Date.parse(article.updatedAt) >= Date.parse(article.publishedAt), article.slug);
	}
});

Deno.test("every article is substantive (700+ words) and every topic has at least one article", () => {
	for (const article of articles) {
		const words = articleWordCount(article);
		assert(words >= 700, `${article.slug} has ${words} words`);
	}
	for (const topic of EDITORIAL_ARTICLE_TOPICS) {
		assert(articles.some((article) => article.topics.includes(topic)), `no article on ${topic}`);
	}
	const primaries = new Set(articles.map((article) => article.topics[0]));
	assertEquals(primaries.size, EDITORIAL_ARTICLE_TOPICS.length, "every topic leads one article");
});

Deno.test("every article names an existing author; the byline is an honest team, not a person", () => {
	const authors = new Map(ARTICLE_AUTHORS.records.map((author) => [author.slug, author]));
	for (const article of articles) assert(authors.has(article.authorSlug), article.slug);
	const editorial = authors.get("projective-editorial");
	assertEquals(editorial?.kind, "team");
	assertEquals(editorial?.href, null);
});

Deno.test("every internal article link resolves to a visible article", () => {
	const now = new Date();
	for (const article of articles) {
		for (const href of hrefsOf(article.sections)) {
			if (!href.startsWith("/articles/")) continue;
			const target = articles.find((other) => `/articles/${other.slug}` === href);
			assert(target, `${article.slug} links to missing ${href}`);
			assert(isEditorialArticleVisible(target, now), `${article.slug} links to hidden ${href}`);
			assert(target.slug !== article.slug, `${article.slug} links to itself`);
		}
	}
});

Deno.test("every cover and avatar is a served static file whose declared size is its real size", async () => {
	const pictures: ContentImage[] = [
		...articles.map((article) => article.cover),
		...ARTICLE_AUTHORS.records.map((author) => author.avatar),
	];
	for (const picture of new Map(pictures.map((p) => [p.src, p])).values()) {
		assert(picture.src.startsWith("/"), `${picture.src} is not a static path`);
		assertFalse(picture.src.includes("banner_3"), "banner_3.jpg is too heavy to be a cover");
		assertEquals(await intrinsicSize(picture.src), { w: picture.w, h: picture.h }, picture.src);
		assert(picture.alt.trim().length > 0, `${picture.src} has no alt text`);
		// A cover is a page's largest paint: keep every one light.
		const { size } = await Deno.stat(new URL(picture.src.replace(/^\//, ""), STATIC));
		assert(size <= 256 * 1024, `${picture.src} is ${size} bytes`);
	}
});

Deno.test("every article has its own cover, so no two are told apart by their titles alone", () => {
	const covers = articles.map((article) => article.cover.src);
	assertEquals(new Set(covers).size, covers.length, covers.join(", "));
});

Deno.test("former slugs name archived articles, one claimant each (the rules no CHECK can state)", () => {
	assertEquals(formerSlugProblems(articles), []);
});

Deno.test("inline figures are labelled 1200×675 placeholders with real alt text", () => {
	assertEquals(placeholderFigure("Stage board"), "https://placehold.co/1200x675?text=Stage+board");
	assertEquals(
		placeholderFigure("Fees & splits"),
		"https://placehold.co/1200x675?text=Fees+%26+splits",
	);
	for (const article of articles) {
		for (const node of article.sections.flatMap((section) => section.body)) {
			if (node.type !== "image") continue;
			assert(node.src.startsWith("https://placehold.co/1200x675?text="), node.src);
			assertEquals([node.w, node.h], [1200, 675]);
			assert(node.alt.length > 20, `${article.slug}: alt text too thin`);
		}
	}
});
// #endregion

// #region Visibility and the two roads
Deno.test("visibility: only a published article whose time has come is shown", () => {
	const base = articles[0];
	const now = new Date("2026-10-17T12:00:00Z");
	const at = (status: EditorialArticleRecord["status"], publishedAt: string) =>
		isEditorialArticleVisible({ ...base, status, publishedAt }, now);
	assert(at("published", "2026-10-17T12:00:00Z"));
	assert(at("published", "2026-01-01T00:00:00Z"));
	assertFalse(at("published", "2026-10-17T12:00:01Z"));
	assertFalse(at("draft", "2026-01-01T00:00:00Z"));
	assertFalse(at("archived", "2026-01-01T00:00:00Z"));
});

Deno.test("the live road maps PostgREST's rows to exactly the records the fixture road serves", async () => {
	const rows = rowsFromRecords(ARTICLES_TABLE, articles).map((row) => ({
		...row,
		// PostgREST spells timestamptz with an offset, not a Z.
		published_at: new Date(row.published_at).toISOString().replace(".000Z", "+00:00"),
		updated_at: new Date(row.updated_at).toISOString().replace(".000Z", "+00:00"),
	}));
	const client = {
		schema: () => ({
			from: () => ({ select: () => Promise.resolve({ data: rows, error: null }) }),
		}),
	} as unknown as SupabaseClient;
	const now = new Date("2026-10-17T12:00:00Z");
	const live = await readEditorialTable(ARTICLES, { source: "live", client, now });
	const fixture = await readEditorialTable(ARTICLES, { source: "fixture", now });
	assert(live.ok && fixture.ok);
	assertEquals(live.data?.records, fixture.data?.records);
	assertEquals(fixture.data?.records[0].publishedAt, "2026-08-26T08:00:00.000Z");
});

Deno.test("a future-dated article is hidden on both roads alike", async () => {
	const early = new Date("2026-09-10T00:00:00Z");
	const fixture = await readEditorialTable(ARTICLES, { source: "fixture", now: early });
	assertEquals(fixture.data?.records.map((article) => article.slug), [
		"asynchronous-collaboration-in-stages",
		"agile-delivery-in-stages",
	]);
});
// #endregion
