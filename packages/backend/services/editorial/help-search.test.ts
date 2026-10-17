import { assert, assertEquals } from "@std/assert";
import type { HelpCentreArticle, HelpCentreCategory } from "@projective/types/editorial";
import { buildHelpLibrary } from "./help-library.ts";
import {
	buildHelpSearchIndex,
	editDistance,
	foldText,
	highlightRuns,
	matchTerm,
	queryTerms,
	searchHelp,
	SNIPPET_MAX,
	tokenize,
} from "./help-search.ts";
import { HELP_ARTICLES, HELP_CATEGORIES } from "./content/help.ts";

/**
 * The help search's matching, ranking, snippets and highlights — on a small synthetic library where
 * every expectation is visible, then on the real content for the queries readers actually type.
 */

// #region Fixtures
const cats: HelpCentreCategory[] = [
	{ slug: "money", position: 0, title: "Money", description: "Money.", icon: "wallet" },
	{ slug: "people", position: 1, title: "People", description: "People.", icon: "members" },
];

function doc(
	slug: string,
	cat: string,
	position: number,
	title: string,
	summary: string,
	heading: string,
	body: string,
): HelpCentreArticle {
	return {
		id: slug,
		slug,
		title,
		summary,
		updatedAt: "2026-10-17",
		version: "2026-10-17",
		sections: [{ id: "s", heading, body: [{ type: "p", content: body }] }],
		category: cat,
		position,
		roles: ["client"],
		startHere: [],
		related: [],
		faq: null,
		publishedOn: "2026-10-17",
		archivedOn: null,
	};
}

const index = buildHelpSearchIndex(buildHelpLibrary(cats, [
	doc(
		"escrow",
		"money",
		0,
		"How escrow works",
		"Money is held before work starts.",
		"Holding",
		"Funds stay held until approval. Withdrawal comes later.",
	),
	doc(
		"fees",
		"money",
		1,
		"Fees",
		"A 5% fee is kept at release.",
		"The service fee",
		"Nothing about escrow here except one mention of escrow.",
	),
	doc(
		"resume",
		"people",
		0,
		"Your résumé",
		"Show your experience.",
		"Profile",
		"A long sentence that keeps going and going so that the snippet has to be cut down to size around the word portfolio which appears only near the end of this rather long sentence indeed.",
	),
]));
// #endregion

// #region Folding and tokens
Deno.test("folding strips diacritics and case; tokens are runs of letters and digits", () => {
	assertEquals(foldText("Résumé ÉSCROW"), "resume escrow");
	assertEquals(tokenize("Fair Exit — 25/50/75%"), ["fair", "exit", "25", "50", "75"]);
});

Deno.test("query terms drop common words unless nothing else is left", () => {
	assertEquals(queryTerms("How do I fund a stage?"), ["fund", "stage"]);
	assertEquals(queryTerms("how"), ["how"]);
	assertEquals(queryTerms("fees fees"), ["fees"]);
	assertEquals(queryTerms("   "), []);
});
// #endregion

// #region Edit distance
Deno.test("edit distance counts a neighbour swap as one edit and stops past the limit", () => {
	assertEquals(editDistance("escrow", "escrow", 1), 0);
	assertEquals(editDistance("escorw", "escrow", 1), 1);
	assertEquals(editDistance("escro", "escrow", 1), 1);
	assertEquals(editDistance("abc", "xyz", 1), 2);
	assertEquals(editDistance("a", "abcdef", 2), 3);
});
// #endregion

// #region Matching
Deno.test("a word matches exactly, as a prefix, or — only as a fallback — with a typo", () => {
	assertEquals(matchTerm(index, "escrow").map((m) => m.term), ["escrow"]);
	assertEquals(matchTerm(index, "esc").map((m) => [m.term, m.closeness]), [["escrow", 0.75]]);
	assertEquals(matchTerm(index, "escorw").map((m) => [m.term, m.closeness]), [["escrow", 0.5]]);
	assertEquals(matchTerm(index, "witdraw").map((m) => m.term), ["withdrawal"]);
	assertEquals(matchTerm(index, "fee").map((m) => m.term), ["fee", "fees"]);
	assertEquals(matchTerm(index, "xyz"), []);
});

Deno.test("diacritics fold on both sides", () => {
	assertEquals(searchHelp(index, "resume").map((r) => r.slug), ["resume"]);
	assertEquals(searchHelp(index, "RÉSUMÉ").map((r) => r.slug), ["resume"]);
});
// #endregion

// #region Ranking
Deno.test("a title match outranks a body match", () => {
	assertEquals(searchHelp(index, "escrow").map((r) => r.slug), ["escrow", "fees"]);
});

Deno.test("every word must match; with no article matching all, the closest are returned", () => {
	assertEquals(searchHelp(index, "escrow fee").map((r) => r.slug), ["fees"]);
	// None matches both words: each matches one, so they rank by score (two title hits, then a body
	// hit), ties in reading order.
	assertEquals(searchHelp(index, "escrow résumé").map((r) => r.slug), ["escrow", "resume", "fees"]);
});

Deno.test("an empty query answers nothing; the limit caps the results", () => {
	assertEquals(searchHelp(index, ""), []);
	assertEquals(searchHelp(index, "   "), []);
	assertEquals(searchHelp(index, "escrow", 1).length, 1);
});
// #endregion

// #region Snippets and highlights
Deno.test("highlights mark whole matched words in the title and the snippet", () => {
	const [hit] = searchHelp(index, "escrow");
	assertEquals(hit.title, "How escrow works");
	assertEquals(hit.highlights.title, [[4, 10]]);
	assertEquals(hit.title.slice(4, 10), "escrow");
	for (const [start, end] of hit.highlights.snippet) {
		assertEquals(foldText(hit.snippet.slice(start, end)), "escrow");
	}
});

Deno.test("the snippet is the first sentence holding a match, else the summary", () => {
	const [fees] = searchHelp(index, "release");
	assertEquals(fees.slug, "fees");
	assertEquals(fees.snippet, "A 5% fee is kept at release.");
	const [byTitle] = searchHelp(index, "works");
	assertEquals(byTitle.snippet, "Money is held before work starts.");
});

Deno.test("a long sentence is cut around its match, on word boundaries", () => {
	const [hit] = searchHelp(index, "portfolio");
	assert(hit.snippet.length <= SNIPPET_MAX + 2, hit.snippet);
	assert(hit.snippet.includes("portfolio"));
	assert(hit.snippet.startsWith("…"));
	assertEquals(hit.highlights.snippet.length, 1);
});

Deno.test("highlightRuns works on original text, diacritics included", () => {
	assertEquals(highlightRuns("Your résumé, again", new Set(["resume"])), [[5, 11]]);
});
// #endregion

// #region The real content
const real = buildHelpSearchIndex(buildHelpLibrary(HELP_CATEGORIES, HELP_ARTICLES));
const top = (q: string) => searchHelp(real, q)[0]?.slug;

Deno.test("real content: the queries readers type find the article that answers them", () => {
	assertEquals(top("escrow"), "what-is-escrow");
	assertEquals(top("fair exit"), "end-a-stage-with-fair-exit");
	assertEquals(top("withdraw"), "withdraw-your-earnings");
	assertEquals(top("pending"), "the-7-day-pending-window");
	assertEquals(top("paid revision"), "free-and-paid-revisions");
	assertEquals(top("no-show"), "report-a-session-no-show");
	assertEquals(top("fees"), "fees");
	assertEquals(top("KYB"), "business-verification-kyb");
});

Deno.test("real content: typos and half-typed words still find their article", () => {
	assertEquals(top("escorw"), "what-is-escrow");
	assertEquals(top("withdr"), "withdraw-your-earnings");
	assertEquals(top("verifcation"), "get-payout-ready");
});

Deno.test("real content: every hit links to its canonical path and its highlights are in bounds", () => {
	for (const q of ["stage", "payout", "team", "card"]) {
		for (const hit of searchHelp(real, q)) {
			assertEquals(hit.href, `/help/${hit.category}/${hit.slug}`);
			for (const [s, e] of [...hit.highlights.title, ...hit.highlights.snippet]) {
				assert(s < e, `${q}: empty run`);
			}
			for (const [, e] of hit.highlights.title) assert(e <= hit.title.length);
			for (const [, e] of hit.highlights.snippet) assert(e <= hit.snippet.length);
		}
	}
});
// #endregion
