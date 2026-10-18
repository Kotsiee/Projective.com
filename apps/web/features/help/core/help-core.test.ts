import { assert, assertEquals } from "@std/assert";
import type { HelpCentreSearchResult } from "@projective/types/editorial";
import { HELP_CENTRE_CATEGORY_ICONS } from "@projective/types/editorial";
import { ICON_PATHS } from "@ui/icons/core/paths.tsx";
import { highlightSegments } from "./highlight.ts";
import {
	clearRecentSearches,
	readRecentSearches,
	RECENT_SEARCHES_KEY,
	RECENT_SEARCHES_MAX,
	type RecentStorage,
	rememberSearch,
} from "./recent-searches.ts";
import {
	groupResults,
	isNavigationKey,
	nextActive,
	withoutQuery,
	withQuery,
} from "./omnibar-model.ts";
import {
	FEEDBACK_ANCHOR,
	feedbackReturnUrl,
	isFormPost,
	parseFeedbackForm,
} from "./feedback-form.ts";

/** The help centre's pure client rules (P2): highlights, recent searches, the overlay, the form road. */

// #region Highlights
Deno.test("highlight segments mark the runs and always rejoin to the text", () => {
	const text = "How stage funding works";
	const segs = highlightSegments(text, [[4, 9], [10, 17]]);
	assertEquals(segs, [
		{ text: "How ", mark: false },
		{ text: "stage", mark: true },
		{ text: " ", mark: false },
		{ text: "funding", mark: true },
		{ text: " works", mark: false },
	]);
	assertEquals(segs.map((s) => s.text).join(""), text);
});

Deno.test("highlight runs are clamped, sorted, merged and empty ones dropped", () => {
	const text = "abcdef";
	assertEquals(highlightSegments(text, [[4, 99], [1, 3], [2, 4], [5, 5], [-3, 0]]), [
		{ text: "a", mark: false },
		{ text: "bcdef", mark: true },
	]);
	assertEquals(highlightSegments("", []), [{ text: "", mark: false }]);
	assertEquals(highlightSegments("abc", []), [{ text: "abc", mark: false }]);
});
// #endregion

// #region Recent searches
/** An in-memory store, optionally one that refuses every call. */
function memoryStore(broken = false): RecentStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	const guard = () => {
		if (broken) throw new DOMException("blocked", "SecurityError");
	};
	return {
		data,
		getItem: (k) => {
			guard();
			return data.get(k) ?? null;
		},
		setItem: (k, v) => {
			guard();
			data.set(k, v);
		},
		removeItem: (k) => {
			guard();
			data.delete(k);
		},
	};
}

Deno.test("recent searches: newest first, no repeats (ignoring case), at most eight", () => {
	const store = memoryStore();
	rememberSearch(store, "escrow");
	rememberSearch(store, "  fair   exit ");
	rememberSearch(store, "ESCROW");
	assertEquals(readRecentSearches(store), ["ESCROW", "fair exit"]);
	for (let i = 0; i < 12; i++) rememberSearch(store, `q${i}`);
	const list = readRecentSearches(store);
	assertEquals(list.length, RECENT_SEARCHES_MAX);
	assertEquals(list[0], "q11");
	assertEquals(rememberSearch(store, "   "), list, "a blank query is not remembered");
});

Deno.test("recent searches: a blocked or corrupt store reads as none and never throws", () => {
	const broken = memoryStore(true);
	assertEquals(readRecentSearches(broken), []);
	assertEquals(rememberSearch(broken, "escrow"), ["escrow"]);
	clearRecentSearches(broken);
	assertEquals(readRecentSearches(null), []);
	const corrupt = memoryStore();
	corrupt.data.set(RECENT_SEARCHES_KEY, "{not json");
	assertEquals(readRecentSearches(corrupt), []);
	corrupt.data.set(RECENT_SEARCHES_KEY, JSON.stringify(["ok", 3, null, ""]));
	assertEquals(readRecentSearches(corrupt), ["ok"]);
	clearRecentSearches(corrupt);
	assertEquals(corrupt.data.has(RECENT_SEARCHES_KEY), false);
});
// #endregion

// #region Overlay model
function hit(slug: string, category: string): HelpCentreSearchResult {
	return {
		slug,
		title: slug,
		category,
		categoryTitle: category.toUpperCase(),
		href: `/help/${category}/${slug}`,
		snippet: "",
		highlights: { title: [], snippet: [] },
	};
}

Deno.test("results group by category in the order their best hit ranked; the flat index follows display", () => {
	const groups = groupResults([hit("a", "money"), hit("b", "people"), hit("c", "money")]);
	assertEquals(
		groups.map((g) => [g.category, g.title, g.items.map((i) => [i.result.slug, i.index])]),
		[
			["money", "MONEY", [["a", 0], ["c", 1]]],
			["people", "PEOPLE", [["b", 2]]],
		],
	);
	assertEquals(groupResults([]), []);
});

Deno.test("arrow keys wrap through the options; none when there are none", () => {
	assertEquals(nextActive(-1, 3, "ArrowDown"), 0);
	assertEquals(nextActive(2, 3, "ArrowDown"), 0);
	assertEquals(nextActive(-1, 3, "ArrowUp"), 2);
	assertEquals(nextActive(0, 3, "ArrowUp"), 2);
	assertEquals(nextActive(1, 3, "Home"), 0);
	assertEquals(nextActive(0, 3, "End"), 2);
	assertEquals(nextActive(0, 0, "ArrowDown"), -1);
	assert(isNavigationKey("ArrowDown") && !isNavigationKey("Enter"));
});

Deno.test("the address bar carries ?q= while the overlay is open and loses only it on close", () => {
	assertEquals(withQuery("https://x.test/help?a=1#faq", "fair exit"), "/help?a=1&q=fair+exit#faq");
	assertEquals(withoutQuery("https://x.test/help?q=fees&a=1#faq"), "/help?a=1#faq");
	assertEquals(
		withoutQuery("https://x.test/help/escrow-and-payments?q="),
		"/help/escrow-and-payments",
	);
});
// #endregion

// #region The form road
Deno.test("the form road: fields read, the answer typed, a blank comment dropped", () => {
	const form = (entries: Record<string, string>) => new URLSearchParams(entries);
	assertEquals(parseFeedbackForm(form({ slug: "fees", helpful: "yes" })), {
		slug: "fees",
		helpful: true,
	});
	assertEquals(parseFeedbackForm(form({ slug: "fees", helpful: "no", comment: "Refunds?" })), {
		slug: "fees",
		helpful: false,
		comment: "Refunds?",
	});
	assertEquals(parseFeedbackForm(form({ slug: "fees", helpful: "no", comment: "  " })), {
		slug: "fees",
		helpful: false,
	});
	assertEquals(parseFeedbackForm(form({ slug: "fees", helpful: "maybe" })).helpful, undefined);
	assert(isFormPost("application/x-www-form-urlencoded; charset=UTF-8"));
	assert(isFormPost("multipart/form-data; boundary=x"));
	assert(!isFormPost("application/json"));
	assert(!isFormPost(null));
});

Deno.test("the form road returns only to a help path, at the helpfulness block", () => {
	assertEquals(
		feedbackReturnUrl("/help/escrow-and-payments/fees", "thanks"),
		`/help/escrow-and-payments/fees?helpful=thanks#${FEEDBACK_ANCHOR}`,
	);
	for (
		const bad of ["https://evil.test/help", "//evil.test", "/help/../admin", "/projects", null]
	) {
		assertEquals(
			feedbackReturnUrl(bad, "error"),
			`/help?helpful=error#${FEEDBACK_ANCHOR}`,
			String(bad),
		);
	}
});
// #endregion

// #region Category glyphs
Deno.test("every category glyph is a registry icon", () => {
	for (const name of HELP_CENTRE_CATEGORY_ICONS) assert(name in ICON_PATHS, name);
});
// #endregion
