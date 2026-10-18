import { assert, assertEquals } from "@std/assert";
import type { ServiceItem, Suggestions, SuggestQuery } from "@projective/types/explore";
import {
	candidateTerms,
	type CatalogueText,
	FALLBACK_TERMS,
	HERO_CHIPS_MAX,
	HERO_TERMS_MAX,
	heroChips,
	heroTerms,
	landingHeroFrom,
	type SuggestRead,
	TERM_CHARS_MAX,
	termFromTitle,
	vocabularyOf,
} from "./landing-hero.ts";
import { suggestFrom } from "./suggest.ts";

/**
 * The landing hero's server-derived search data: generic phrases read off listing titles (names and
 * acronyms cut out), each confirmed by the typeahead, the fallbacks topping up a short list, and the
 * "Try:" chips (`flows/LANDING.md` §4.1 `[U2]` `[U3]`).
 */

// #region Fixtures
/** The catalogue's text: what makes "brand", "mobile" … ordinary words and "Loop" a name. */
const TEXT: CatalogueText[] = [
	{ title: "Verdant brand refresh", summary: "A new logo and brand voice for a garden shop." },
	{
		title: "Loop mobile app",
		summary: "Our client Loop needs a habit tracker. The mobile app ships first.",
	},
	{ title: "Brand identity sprint", summary: "", skills: [{ label: "Brand identity" }] },
	{ title: "Landing page in a week", summary: "One landing page, designed and built." },
	{ title: "Aurora UI kit", summary: "Components for a design system." },
	{ title: "Realtime MVP build", summary: "A realtime build, end to end." },
	{ title: "Atlas analytics platform", summary: "Dashboards for an analytics platform." },
	{ title: "Design mentorship block", summary: "Weekly design mentorship sessions." },
	{ title: "Feedback loop audit", summary: "" },
];

const VOCABULARY = vocabularyOf(TEXT);

const RECOMMENDED = {
	services: [
		{ title: "Brand identity sprint" },
		{ title: "Landing page in a week" },
		{ title: "Aurora UI kit" },
		{ title: "Design mentorship block" },
	],
	projects: [
		{ title: "Loop mobile app" },
		{ title: "Verdant brand refresh" },
		{ title: "Realtime MVP build" },
		{ title: "Atlas analytics platform" },
	],
};

/** A suggest answer with the given parts (everything else empty). */
function answer(parts: Partial<Suggestions> = {}): Suggestions {
	return { q: "", scope: "all", hits: [], terms: [], handles: [], trending: [], ...parts };
}

/** A read that hits only for `known` terms (case-insensitive) and records every query. */
function fakeRead(known: readonly string[], trending: string[] = []) {
	const asked: SuggestQuery[] = [];
	const read: SuggestRead = (query) => {
		asked.push(query);
		if (!query.q) return answer({ trending });
		const hit = known.some((term) => term.toLowerCase() === query.q.toLowerCase());
		return answer({
			q: query.q,
			hits: hit
				? [{ id: "s1", type: "services", title: query.q, ownerName: "Ada", ownerHandle: "@ada" }]
				: [],
		});
	};
	return { read, asked };
}
// #endregion

// #region Terms
Deno.test("landing-hero: a term is a title's generic phrase — names and acronyms cut out", () => {
	assertEquals(termFromTitle("Verdant brand refresh", VOCABULARY), "brand refresh");
	assertEquals(termFromTitle("Loop mobile app", VOCABULARY), "mobile app");
	assertEquals(termFromTitle("Atlas analytics platform", VOCABULARY), "analytics platform");
	assertEquals(termFromTitle("Brand identity sprint", VOCABULARY), "brand identity sprint");
	assertEquals(termFromTitle("Landing page in a week", VOCABULARY), "landing page");
	assertEquals(termFromTitle("Design mentorship block", VOCABULARY), "design mentorship block");
	assertEquals(termFromTitle("Aurora UI kit", VOCABULARY), null);
	assertEquals(termFromTitle("Realtime MVP build", VOCABULARY), null);
	assertEquals(termFromTitle("Logo", VOCABULARY), null);
});

Deno.test("landing-hero: a word a summary capitalises mid-sentence is a name, even when also written lower case", () => {
	// "loop" is written lower case ("Feedback loop audit"), but "our client Loop" makes it a name.
	assert(VOCABULARY.lower.has("loop"));
	assert(VOCABULARY.named.has("loop"));
	assertEquals(termFromTitle("Loop habit tracker", VOCABULARY), "habit tracker");
	// Sentence-initial capitals prove nothing: "The mobile app ships first." keeps "the" out of names.
	assertEquals(VOCABULARY.named.has("the"), false);
});

Deno.test("landing-hero: no derived term carries a capital, and none is longer than the cap", () => {
	for (const term of candidateTerms(RECOMMENDED, VOCABULARY)) {
		assertEquals(term, term.toLowerCase(), term);
		assert(term.length <= TERM_CHARS_MAX, term);
		assert(term.split(" ").length >= 2, term);
	}
	assertEquals(
		termFromTitle(
			"Responsive marketing website redesign",
			vocabularyOf([
				{ title: "x responsive marketing website redesign" },
			]),
		),
		"responsive marketing website",
	);
});

Deno.test("landing-hero: candidates interleave services and projects, de-duplicated", () => {
	assertEquals(candidateTerms(RECOMMENDED, VOCABULARY), [
		"brand identity sprint",
		"mobile app",
		"landing page",
		"brand refresh",
		"design mentorship block",
		"analytics platform",
	]);
	assertEquals(candidateTerms(null, VOCABULARY), []);
	const repeated = {
		services: [{ title: "Brand refresh" }, { title: "brand refresh" }],
		projects: [],
	};
	assertEquals(candidateTerms(repeated, VOCABULARY), ["brand refresh"]);
});
// #endregion

// #region Confirmation and chips
Deno.test("landing-hero: only terms the typeahead hits survive, derived first", () => {
	const { read, asked } = fakeRead([
		"brand identity sprint",
		"mobile app",
		"landing page",
		"brand refresh",
		"analytics platform",
	]);
	const terms = heroTerms(RECOMMENDED, VOCABULARY, read);
	assertEquals(terms, [
		"brand identity sprint",
		"mobile app",
		"landing page",
		"brand refresh",
		"analytics platform",
	]);
	assert(terms.length <= HERO_TERMS_MAX);
	assert(asked.every((query) => query.scope === "all"));
	assertEquals(asked.length, candidateTerms(RECOMMENDED, VOCABULARY).length);
});

Deno.test("landing-hero: fallbacks top up a short list, each confirmed first", () => {
	const { read } = fakeRead(["landing page", "motion design", "brand identity"]);
	assertEquals(heroTerms(RECOMMENDED, VOCABULARY, read), [
		"landing page",
		"brand identity",
		"motion design",
	]);
	const none = fakeRead([]);
	assertEquals(heroTerms(null, VOCABULARY, none.read), []);
	assertEquals(none.asked.length, FALLBACK_TERMS.length);
});

Deno.test("landing-hero: chips are the trending terms, else the confirmed terms, capped", () => {
	assertEquals(heroChips(["Brand identity", "brand identity", "Webflow", " "], ["landing page"]), [
		"Brand identity",
		"Webflow",
	]);
	assertEquals(heroChips([], ["landing page", "motion design"]), ["landing page", "motion design"]);
	assertEquals(heroChips([], []), []);
	assertEquals(heroChips(["a1", "a2", "a3", "a4", "a5", "a6", "a7"], []).length, HERO_CHIPS_MAX);
});

Deno.test("landing-hero: the whole hero from the live typeahead over a catalogue", () => {
	const NOW = Date.parse("2026-10-12T00:00:00Z");
	const service = (id: string, title: string, summary: string): ServiceItem => ({
		id,
		type: "services",
		title,
		owner: { handle: "@studio", name: "North Studio", avatar: "", kind: "team" },
		skills: [{ label: "Branding", category: "design" }],
		summary,
		createdAt: "2026-10-01",
		price: "$100",
		delivery: "5-day delivery",
		category: "branding",
		serviceType: "One-Off",
	});
	const items = [
		service("s1", "Verdant brand refresh", "A brand refresh for a garden shop."),
		service("s2", "Loop mobile app", "We built Loop as a mobile app."),
		service("s3", "Landing page in a week", "A landing page, designed and built."),
	];
	const hero = landingHeroFrom(
		items,
		{ services: items, projects: [] },
		(query) => suggestFrom(items, query, NOW),
	);
	assertEquals(hero.terms, ["brand refresh", "mobile app", "landing page"]);
	assert(hero.terms.every((term) => !/verdant|loop/i.test(term)));
	assertEquals(hero.chips, hero.trending.length > 0 ? hero.trending.slice(0, 5) : hero.terms);
});
// #endregion
