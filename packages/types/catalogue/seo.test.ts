import { assertEquals } from "@std/assert";
import {
	ListingTagsSchema,
	SERP_DESCRIPTION_MAX,
	SERP_TITLE_MAX,
	serpSnippet,
	truncateWords,
} from "./seo.ts";

const base = {
	slug: "svc-23456789ab",
	title: "Brand identity sprint",
	descriptionText: "A focused two-week sprint for a new brand.",
	seo: { seoTitle: "", seoDescription: "" },
};

Deno.test("empty overrides fall back to the title and description", () => {
	const snippet = serpSnippet(base);
	assertEquals(snippet.title, "Brand identity sprint");
	assertEquals(snippet.description, "A focused two-week sprint for a new brand.");
	assertEquals(snippet.url, "projective.com › view › svc-23456789ab");
	assertEquals(snippet.truncated, { title: false, description: false });
});

Deno.test("overrides win over the fallbacks", () => {
	const snippet = serpSnippet({
		...base,
		seo: { seoTitle: "Logo design in two weeks", seoDescription: "Fixed price, three concepts." },
	});
	assertEquals(snippet.title, "Logo design in two weeks");
	assertEquals(snippet.description, "Fixed price, three concepts.");
});

Deno.test("a whitespace-only override still falls back", () => {
	assertEquals(
		serpSnippet({ ...base, seo: { seoTitle: "   ", seoDescription: "\n" } }).title,
		base.title,
	);
});

Deno.test("the description fallback is cut near 155 characters on a word boundary", () => {
	const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
	const snippet = serpSnippet({ ...base, descriptionText: words });
	assertEquals(snippet.truncated.description, true);
	assertEquals(snippet.description.endsWith("…"), true);
	assertEquals(snippet.description.length <= SERP_DESCRIPTION_MAX, true);
	assertEquals(words.startsWith(snippet.description.slice(0, -1)), true);
	assertEquals(words.charAt(snippet.description.length - 1), " ");
});

Deno.test("a long title is cut near 60 characters", () => {
	const snippet = serpSnippet({
		...base,
		title: "Complete brand identity sprint with logo, palette, typography and guidelines",
	});
	assertEquals(snippet.truncated.title, true);
	assertEquals(snippet.title.length <= SERP_TITLE_MAX, true);
	assertEquals(snippet.title, "Complete brand identity sprint with logo, palette…");
});

Deno.test("truncateWords collapses whitespace and only cuts when needed", () => {
	assertEquals(truncateWords("  a   b\n c ", 10), { text: "a b c", truncated: false });
	assertEquals(truncateWords("exactly ten", 11), { text: "exactly ten", truncated: false });
	assertEquals(truncateWords("one two three", 9), { text: "one two…", truncated: true });
	assertEquals(truncateWords("unbreakableword", 6), { text: "unbre…", truncated: true });
});

Deno.test("a listing carries at most ten tags of at most forty characters", () => {
	const tags = (n: number) => Array.from({ length: n }, (_, i) => `tag${i}`);
	assertEquals(ListingTagsSchema.safeParse(tags(10)).success, true);
	assertEquals(ListingTagsSchema.safeParse(tags(11)).success, false);
	assertEquals(ListingTagsSchema.safeParse(["x".repeat(41)]).success, false);
	assertEquals(ListingTagsSchema.safeParse([" "]).success, false);
});
