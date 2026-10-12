import { assertEquals } from "@std/assert";
import { suggestFrom, trendingTerms } from "./suggest.ts";
import type { ExploreItem, ProfileItem, ServiceItem } from "@projective/types/explore";

/**
 * The typeahead's matching contract: prefix, not substring; a phrase prefix outranks a word prefix;
 * `@` searches handles only; and an empty query answers with trending alone.
 */

// #region Corpus
const NOW = Date.parse("2026-10-12T00:00:00Z");

function service(id: string, title: string, extra: Partial<ServiceItem> = {}): ServiceItem {
	return {
		id,
		type: "services",
		title,
		owner: { handle: "@studio", name: "North Studio", avatar: "", kind: "team" },
		skills: [{ label: "Branding", category: "design" }],
		summary: "",
		createdAt: "2026-10-01",
		price: "$100",
		delivery: "5-day delivery",
		category: "branding",
		serviceType: "One-Off",
		...extra,
	};
}

function person(handle: string, name: string, verified = false): ProfileItem {
	return {
		id: handle,
		type: "freelancers",
		title: name,
		owner: { handle: `@${handle}`, name, avatar: "", kind: "freelancer", verified },
		skills: [{ label: "Figma", category: "design" }],
		summary: "",
		createdAt: "2025-01-01",
		craft: "",
		cover: "",
		delivered: 0,
	} as ProfileItem;
}

const corpus: ExploreItem[] = [
	service("sv-zebra", "Zebra brand print"),
	service("sv-refresh", "Brand refresh sprint"),
	service("sv-identity", "Identity system, brand-led"),
	person("juno", "Juno Brandt", true),
	person("bram", "Bram Okafor"),
];
// #endregion

Deno.test("a phrase prefix outranks a word prefix, and a mid-word match is not a match", () => {
	const s = suggestFrom(corpus, { q: "bran", scope: "all" }, NOW);
	assertEquals(s.hits.map((h) => h.id), ["sv-refresh", "sv-zebra"]);
	assertEquals(s.terms[0], { label: "Branding", kind: "category", count: 3 });
	assertEquals(s.handles.map((h) => h.handle), ["@juno"]);
	assertEquals(suggestFrom(corpus, { q: "ebra", scope: "all" }, NOW).hits, []);
});

Deno.test("an @ query searches handles only", () => {
	const s = suggestFrom(corpus, { q: "@br", scope: "all" }, NOW);
	assertEquals(s.hits, []);
	assertEquals(s.terms, []);
	assertEquals(s.handles.map((h) => h.handle), ["@bram"]);
	assertEquals(suggestFrom(corpus, { q: "@", scope: "all" }, NOW).handles, []);
});

Deno.test("a listing scope has no people section", () => {
	assertEquals(suggestFrom(corpus, { q: "bra", scope: "services" }, NOW).handles, []);
});

Deno.test("an empty query answers with trending only, recent listings first", () => {
	const s = suggestFrom(corpus, { q: "  ", scope: "all" }, NOW);
	assertEquals(s.hits, []);
	assertEquals(s.trending, ["Branding", "Figma"]);
	assertEquals(trendingTerms([person("old", "Old Hand")], NOW), ["Figma"]);
});

Deno.test("trending items' topics lead, in activity order; out-of-scope ids are ignored", () => {
	const s = suggestFrom(corpus, { q: "", scope: "all" }, NOW, ["juno", "gone"]);
	assertEquals(s.trending, ["Figma", "Branding"]);
	const services = suggestFrom(corpus, { q: "", scope: "services" }, NOW, ["juno"]);
	assertEquals(services.trending, ["Branding"]);
});
