import { assert, assertEquals } from "@std/assert";
import type { ExploreItem, ServiceItem } from "@projective/types/explore";
import {
	exactTitlesFirst,
	foldWord,
	lexicalScorer,
	parseLexicalQuery,
	wordsOf,
} from "./lexical.ts";

/**
 * The lexical scorer's word rules, each pinned on its own; the ranking they add up to is pinned by
 * the relevance fixture (`best-match.test.ts`).
 */

// #region Corpus
function service(id: string, title: string, extra: Partial<ServiceItem> = {}): ServiceItem {
	return {
		id,
		type: "services",
		title,
		owner: { handle: "@studio", name: "Studio", avatar: "", kind: "team" },
		skills: [],
		summary: "A test service.",
		createdAt: "2026-09-01",
		price: "$900",
		delivery: "10-day delivery",
		category: "web",
		serviceType: "One-Off",
		...extra,
	};
}

const TITLE = service("svc-title", "Logo refresh");
const TAGS = service("svc-tags", "Refresh pack", {
	skills: [{ label: "Logo design", category: "design" }],
});
const SUMMARY = service("svc-summary", "Refresh pack", { summary: "We redraw your logo." });
const OWNER = service("svc-owner", "Refresh pack", {
	owner: { handle: "@logoworks", name: "Logo Works", avatar: "", kind: "team" },
});
const PREFIX = service("svc-prefix", "Logotype sprint");
const INFIX = service("svc-infix", "Design review");
const FILLER = Array.from({ length: 8 }, (_, i) => service(`svc-filler-${i}`, `Filler ${i}`));
const CORPUS: ExploreItem[] = [TITLE, TAGS, SUMMARY, OWNER, PREFIX, INFIX, ...FILLER];

function score(item: ExploreItem, q: string, corpus: readonly ExploreItem[] = CORPUS): number {
	const scorer = lexicalScorer(corpus, q);
	assert(scorer, `"${q}" has words`);
	return scorer.score(item);
}
// #endregion

Deno.test("words are lower-case, accent-free and split on anything that is not a letter or digit", () => {
	assertEquals(wordsOf("Café-Branding, UI kit — 3D!"), ["cafe", "branding", "ui", "kit", "3d"]);
	assertEquals(wordsOf("   "), []);
});

Deno.test("plurals fold onto their singular, and short or double-s words are left alone", () => {
	assertEquals(foldWord("logos"), "logo");
	assertEquals(foldWord("agencies"), "agency");
	assertEquals(foldWord("sketches"), "sketch");
	assertEquals(foldWord("boxes"), "box");
	assertEquals(foldWord("phases"), "phase");
	assertEquals(foldWord("systems"), "system");
	assertEquals(foldWord("class"), "class");
	assertEquals(foldWord("ux"), "ux");
	assertEquals(foldWord("bus"), "bus");
});

Deno.test("stop words are dropped from the scored words unless they are all there is", () => {
	assertEquals(parseLexicalQuery("logo for a startup")?.terms, ["logo", "startup"]);
	assertEquals(parseLexicalQuery("the")?.terms, ["the"]);
	assertEquals(parseLexicalQuery("the")?.stopWordsOnly, true);
	assertEquals(parseLexicalQuery("!!! —"), null);
	assertEquals(lexicalScorer(CORPUS, "—"), null);
});

Deno.test("a word counts most in the title, then the tags, then the summary, then the owner", () => {
	const title = score(TITLE, "logo");
	const tags = score(TAGS, "logo");
	const summary = score(SUMMARY, "logo");
	const owner = score(OWNER, "logo");
	assert(title > tags, `title ${title} > tags ${tags}`);
	assert(tags > summary, `tags ${tags} > summary ${summary}`);
	assert(summary > owner, `summary ${summary} > owner ${owner}`);
	assert(owner > 0);
});

Deno.test("a word that begins another earns part credit; one found inside another earns none", () => {
	assert(score(PREFIX, "logo") > 0);
	assert(score(PREFIX, "logo") < score(TITLE, "logo"));
	assertEquals(score(INFIX, "sign"), 0);
});

Deno.test("every score lies between 0 and 1", () => {
	for (const q of ["logo", "logo refresh", "refresh pack logo", "the", "zzz"]) {
		for (const item of CORPUS) {
			const s = score(item, q);
			assert(s >= 0 && s <= 1, `${item.id} on "${q}" = ${s}`);
		}
	}
});

Deno.test("a rarer word weighs more than a common one", () => {
	const corpus = [
		service("svc-a", "Refresh logo"),
		service("svc-b", "Refresh pack"),
		service("svc-c", "Refresh kit"),
		service("svc-d", "Refresh set"),
	];
	const rare = score(corpus[0], "logo refresh", corpus);
	const common = score(corpus[1], "logo refresh", corpus);
	assert(
		rare > common,
		`matching the rare word (${rare}) beats matching the common one (${common})`,
	);
});

Deno.test("the words in the order typed score above the same words reversed", () => {
	const ordered = service("svc-ordered", "Brand identity sprint");
	const reversed = service("svc-reversed", "Identity brand sprint");
	const corpus = [ordered, reversed, ...FILLER];
	assert(score(ordered, "brand identity", corpus) > score(reversed, "brand identity", corpus));
});

Deno.test("an exact title ignores case, accents, punctuation and plurals, and nothing else", () => {
	const scorer = lexicalScorer(CORPUS, "LOGO refreshes!");
	assert(scorer?.exactTitle(TITLE));
	assert(!lexicalScorer(CORPUS, "logo")?.exactTitle(TITLE));
	assert(!lexicalScorer(CORPUS, "logo refresh pack")?.exactTitle(TITLE));
});

Deno.test("exactTitlesFirst lifts exact titles and keeps every other item in its order", () => {
	const order = [PREFIX, TAGS, TITLE, SUMMARY];
	assertEquals(exactTitlesFirst(order, "logo refresh").map((it) => it.id), [
		"svc-title",
		"svc-prefix",
		"svc-tags",
		"svc-summary",
	]);
	assertEquals(exactTitlesFirst(order, "").map((it) => it.id), order.map((it) => it.id));
});
