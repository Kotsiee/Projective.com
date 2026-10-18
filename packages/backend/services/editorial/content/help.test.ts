import { assert, assertEquals } from "@std/assert";
import type { ContentNode, InlineContent, ListNode } from "@projective/types/content";
import {
	CONTENT_AUDIENCE_LABEL,
	type ContentAudience,
	RESERVED_ANCHOR_IDS,
} from "@projective/types/content";
import { HelpFeedbackInputSchema } from "@projective/types/community";
import {
	HELP_CENTRE_CATEGORY_SLUGS,
	HELP_CENTRE_FAQ_SIZE,
	HELP_CENTRE_RELATED_MAX,
	HELP_CENTRE_SLUG_MAX,
	HelpCentreCategoryRowSchema,
} from "@projective/types/editorial";
import { recordsFromRows } from "../../../core/row-mapper.ts";
import {
	HELP_ARTICLE_CONTENT,
	HELP_ARTICLE_TABLE,
	HELP_ARTICLES,
	HELP_CATEGORIES,
	HELP_CATEGORY_CONTENT,
	HELP_CATEGORY_TABLE,
	HELP_CONTENT,
} from "./help.ts";

/**
 * The help centre's content source (P2): every record is one the database accepts, every
 * cross-reference resolves, and the hub's FAQ and role columns are the size the hub expects.
 * "Inaccurate help is worse than none" — the citations each article's JSDoc carries are checked to
 * exist, so an article cannot land without saying which part of the spec it explains.
 */

/** The ids the article page renders beside the body (`HelpArticlePage`): no section may take them. */
const PAGE_IDS = ["was-this-helpful", "related-articles"];

// #region Walking a body
/** Every inline run in a body, and every image source. */
function walk(nodes: readonly ContentNode[]): { inline: InlineContent[]; images: string[] } {
	const inline: InlineContent[] = [];
	const images: string[] = [];
	const list = (node: ListNode) => {
		for (const item of node.items) {
			if (typeof item === "string") inline.push(item);
			else {
				inline.push(item.content);
				if (item.list) list(item.list);
			}
		}
	};
	for (const node of nodes) {
		switch (node.type) {
			case "p":
			case "quote":
				inline.push(node.content);
				break;
			case "list":
				list(node);
				break;
			case "callout":
				for (const block of node.body) {
					if (block.type === "p") inline.push(block.content);
					else list(block);
				}
				break;
			case "table":
				for (const cell of [...node.head, ...node.rows.flat()]) inline.push(cell);
				break;
			case "dl":
				for (const item of node.items) inline.push(item.definition);
				break;
			case "image":
				images.push(node.src);
				break;
			default:
				break;
		}
	}
	return { inline, images };
}

/** Every link target in a body. */
function linksOf(nodes: readonly ContentNode[]): string[] {
	return walk(nodes).inline.flatMap((content) =>
		typeof content === "string"
			? []
			: content.flatMap((run) => typeof run === "object" && run.type === "link" ? [run.href] : [])
	);
}
// #endregion

Deno.test("every record passes its table's row schema and maps back unchanged", () => {
	for (const content of HELP_CONTENT.tables) content.rows();
	assertEquals(
		recordsFromRows(HELP_ARTICLE_TABLE, HELP_ARTICLE_CONTENT.rows()),
		[...HELP_ARTICLES],
	);
	assertEquals(HELP_CATEGORY_CONTENT.rows().length, HELP_CATEGORIES.length);
});

Deno.test("about thirty articles across the eight topics, each topic with at least three", () => {
	assert(HELP_ARTICLES.length >= 30, `${HELP_ARTICLES.length} articles`);
	assertEquals(HELP_CATEGORIES.length, 8);
	for (const category of HELP_CATEGORIES) {
		const count = HELP_ARTICLES.filter((a) => a.category === category.slug).length;
		assert(count >= 3, `${category.slug} has ${count}`);
	}
});

Deno.test("slugs and positions are unique, and no article slug is also a category slug", () => {
	const categorySlugs = HELP_CATEGORIES.map((c) => c.slug);
	assertEquals(new Set(categorySlugs).size, categorySlugs.length);
	assertEquals(new Set(HELP_CATEGORIES.map((c) => c.position)).size, HELP_CATEGORIES.length);
	const articleSlugs = HELP_ARTICLES.map((a) => a.slug);
	assertEquals(new Set(articleSlugs).size, articleSlugs.length);
	for (const slug of articleSlugs) assert(!categorySlugs.includes(slug), slug);
	for (const category of categorySlugs) {
		const positions = HELP_ARTICLES.filter((a) => a.category === category).map((a) => a.position);
		assertEquals(new Set(positions).size, positions.length, category);
	}
	for (const article of HELP_ARTICLES) {
		assert(categorySlugs.includes(article.category), article.slug);
	}
});

Deno.test("the hub's FAQ holds exactly eight questions, ranked 1 to 8", () => {
	const ranks = HELP_ARTICLES.flatMap((a) => a.faq ? [a.faq.rank] : []).sort((a, b) => a - b);
	assertEquals(ranks, Array.from({ length: HELP_CENTRE_FAQ_SIZE }, (_, i) => i + 1));
	for (const article of HELP_ARTICLES) {
		if (article.faq) assert(article.faq.question.endsWith("?"), article.slug);
	}
});

Deno.test("every related article exists and is another article", () => {
	const slugs = new Set(HELP_ARTICLES.map((a) => a.slug));
	for (const article of HELP_ARTICLES) {
		assert(article.related.length <= HELP_CENTRE_RELATED_MAX, article.slug);
		assert(article.related.length > 0, `${article.slug} relates to nothing`);
		for (const slug of article.related) {
			assert(slugs.has(slug), `${article.slug} → ${slug}`);
			assert(slug !== article.slug, article.slug);
		}
	}
});

Deno.test("each role's Start here column holds four to six articles written for it", () => {
	for (const role of Object.keys(CONTENT_AUDIENCE_LABEL) as ContentAudience[]) {
		const picks = HELP_ARTICLES.filter((a) => a.startHere.includes(role));
		assert(picks.length >= 4 && picks.length <= 6, `${role}: ${picks.length}`);
		for (const pick of picks) assert(pick.roles.includes(role), `${pick.slug} for ${role}`);
	}
});

Deno.test("every help link resolves, and every image is a placeholder or a static test image", () => {
	const paths = new Set([
		"/help",
		...HELP_CATEGORIES.map((c) => `/help/${c.slug}`),
		...HELP_ARTICLES.map((a) => `/help/${a.category}/${a.slug}`),
	]);
	for (const article of HELP_ARTICLES) {
		for (const section of article.sections) {
			for (const href of linksOf(section.body)) {
				if (href.startsWith("/help")) assert(paths.has(href), `${article.slug}: ${href}`);
				else assert(href.startsWith("/"), `${article.slug}: external ${href}`);
			}
			for (const src of walk(section.body).images) {
				assert(
					src.startsWith("https://placehold.co/") || src.startsWith("/test_images/"),
					`${article.slug}: ${src}`,
				);
			}
		}
	}
});

Deno.test("no section takes an id the article page or the layout owns", () => {
	for (const article of HELP_ARTICLES) {
		for (const section of article.sections) {
			assert(!PAGE_IDS.includes(section.id), `${article.slug}#${section.id}`);
			assert(!RESERVED_ANCHOR_IDS.includes(section.id), `${article.slug}#${section.id}`);
		}
	}
});

Deno.test("every article's source cites the spec section or decision it explains", async () => {
	const dir = new URL("./help/", import.meta.url);
	let cited = 0;
	for await (const entry of Deno.readDir(dir)) {
		if (!entry.name.endsWith(".ts") || ["define.ts", "categories.ts"].includes(entry.name)) {
			continue;
		}
		const text = await Deno.readTextFile(new URL(entry.name, dir));
		const calls = text.split("= helpArticle({").length - 1;
		const blocks = [...text.matchAll(/\/\*\*([\s\S]*?)\*\/\s*const \w+ = helpArticle\(\{/g)];
		assertEquals(blocks.length, calls, `${entry.name}: an article without its JSDoc`);
		for (const [, doc] of blocks) {
			assert(/PRODUCT_SPEC|Decision #\d+|finance-model/.test(doc), `${entry.name}: ${doc.trim()}`);
		}
		cited += calls;
	}
	assertEquals(cited, HELP_ARTICLES.length);
});

Deno.test("help slugs stay within the one bound the tables and a vote share", () => {
	for (const slug of [...HELP_CATEGORIES.map((c) => c.slug), ...HELP_ARTICLES.map((a) => a.slug)]) {
		assert(slug.length <= HELP_CENTRE_SLUG_MAX, slug);
	}
	const long = "a".repeat(HELP_CENTRE_SLUG_MAX);
	assert(HelpFeedbackInputSchema.safeParse({ slug: long, helpful: true }).success);
	const row = { ...HELP_CATEGORY_TABLE.toRow(HELP_CATEGORIES[0]), slug: `${long}a` };
	assert(!HelpCentreCategoryRowSchema.safeParse(row).success, "an over-long slug is refused");
});

Deno.test("the categories are the one slug list, in hub order (the contact form's topics read it)", () => {
	assertEquals(
		[...HELP_CATEGORIES].sort((a, b) => a.position - b.position).map((c) => c.slug),
		[...HELP_CENTRE_CATEGORY_SLUGS],
	);
});
