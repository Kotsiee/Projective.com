import { assert, assertEquals } from "@std/assert";
import type { DocSection } from "@projective/types/content";
import { EDITORIAL_ARTICLE_TOPICS } from "@projective/types/editorial";
import { articleCtaFor, CTA_READ_SHARE, ctaSectionIndex } from "./article-cta.ts";

/**
 * The article's one call to action (P6): chosen by the primary topic — `/join` for a guest, a real
 * place in the product for a signed-in reader — and placed after ~60% of the body.
 */

/** A section of `words` words. */
function section(id: string, words: number): DocSection {
	return {
		id,
		heading: "H",
		body: [{ type: "p", content: Array.from({ length: Math.max(1, words) }, () => "w").join(" ") }],
	};
}

Deno.test("every topic has a call to action; a guest is invited to join, a member is not", () => {
	for (const topic of EDITORIAL_ARTICLE_TOPICS) {
		const guest = articleCtaFor(topic, false);
		const member = articleCtaFor(topic, true);
		assertEquals(guest.href, "/join", topic);
		assert(member.href !== "/join" && member.href.startsWith("/"), topic);
		assertEquals(guest.title, member.title);
		assert(guest.title.length > 0 && guest.body.length > 0 && member.label.length > 0);
	}
	assertEquals(articleCtaFor("agile-delivery", false).title, "Run your next project in stages");
	assertEquals(articleCtaFor("agile-delivery", true).href, "/projects?create=1");
});

Deno.test("placement: after the section where 60% of the words have been read", () => {
	assertEquals(CTA_READ_SHARE, 0.6);
	// Heading words count too: each section here is its body plus a one-word heading.
	assertEquals(
		ctaSectionIndex([
			section("a", 9),
			section("b", 9),
			section("c", 9),
			section("d", 9),
			section("e", 9),
		]),
		2,
	);
	assertEquals(ctaSectionIndex([section("a", 79), section("b", 9), section("c", 9)]), 0);
	assertEquals(ctaSectionIndex([section("a", 9), section("b", 9), section("c", 79)]), 1);
});

Deno.test("placement: never after the last section of a longer article; a one-section article ends with it", () => {
	assertEquals(ctaSectionIndex([section("a", 1), section("b", 99)]), 0);
	assertEquals(ctaSectionIndex([section("only", 50)]), 0);
	assertEquals(ctaSectionIndex([]), 0);
});
