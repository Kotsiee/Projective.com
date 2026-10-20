/**
 * features-seo.test — the head facts of `/features` (`flows/LANDING.md` §4.12): the document title
 * and the social card are §4.12's meta title word for word (the brand once, never a second
 * " · Projective"), the description is §4.12's, and the canonical URL carries no query.
 */
import { assertEquals, assertFalse } from "@std/assert";
import { featuresPageMeta } from "./features-seo.ts";
import { FEATURES_META } from "./features-catalogue.ts";

const ORIGIN = "https://projective.test";

Deno.test("the document title is §4.12's meta title word for word, the brand once", () => {
	const meta = featuresPageMeta(ORIGIN);
	assertEquals(meta.title, "Projective features — teams, boards and payment protection");
	assertEquals(meta.title, FEATURES_META.title);
	assertFalse(meta.title.endsWith("· Projective"));
	assertEquals(meta.og.title, FEATURES_META.title);
});

Deno.test("the description is §4.12's and the canonical is /features with no query", () => {
	const meta = featuresPageMeta(ORIGIN);
	assertEquals(meta.description, FEATURES_META.description);
	assertEquals(meta.og.description, FEATURES_META.description);
	assertEquals(meta.canonical, `${ORIGIN}/features`);
	assertEquals(meta.robots, "index, follow");
});
