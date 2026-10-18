/**
 * hero-search.test — the hero search's pure model: the picker's real categories and the URLs they
 * land on (through `explorePath`), the chips' links, the typewriter (off under reduced motion, one
 * cycle per example, a turn long enough for the longest term, the narrow cap), the calls to action
 * per viewer, and the suggestion groups. The server's term derivation is tested beside it, in
 * `packages/backend/services/explore/landing-hero.test.ts`.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import type { Suggestions } from "@projective/types/explore";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { matchRecent } from "@features/explore/core/search-history.ts";
import {
	chipHref,
	flattenRows,
	GUEST_VIEWER,
	HERO_CATEGORIES,
	HERO_SEARCH_COPY,
	heroCategory,
	heroCtas,
	heroSearchHref,
	heroViewerOf,
	moveActive,
	sheetButtonLabel,
	suggestAnnouncement,
	suggestSections,
	toHeroCategory,
	TYPEWRITER_START,
	TYPEWRITER_TIMING,
	typewriterAllowed,
	typewriterCapped,
	typewriterCycleMs,
	typewriterSentence,
	type TypewriterState,
	typewriterStep,
	typewriterTurnMs,
	typewriterTyped,
} from "./hero-search.ts";
import { HERO_TIMING } from "./hero-motion.ts";

// #region Fixtures
/** A suggest answer with the given parts (everything else empty). */
function answer(parts: Partial<Suggestions> = {}): Suggestions {
	return { q: "", scope: "all", hits: [], terms: [], handles: [], trending: [], ...parts };
}

// #endregion

// #region Categories and URLs
Deno.test("hero-search: the picker offers the real categories, Products left out", () => {
	assertEquals(HERO_CATEGORIES.map((option) => option.value), [
		"all",
		"freelancers",
		"services",
		"projects",
		"businesses",
	]);
	assertEquals(HERO_CATEGORIES.map((option) => option.label), [
		"All",
		"Freelancers & teams",
		"Services",
		"Projects",
		"Businesses",
	]);
	assertFalse(HERO_CATEGORIES.some((option) => option.value === ("products" as string)));
	assertEquals(heroCategory("freelancers").label, "Freelancers & teams");
	assertEquals(toHeroCategory("teams"), "all");
	assertEquals(toHeroCategory("products"), "all");
	assertEquals(toHeroCategory(null), "all");
	assertEquals(toHeroCategory("businesses"), "businesses");
	assertEquals(sheetButtonLabel("services"), "Choose what to search (now: Services)");
});

Deno.test("hero-search: every category's search lands on explorePath(category, q)", () => {
	for (const { value } of HERO_CATEGORIES) {
		assertEquals(heroSearchHref(value, "  brand identity "), explorePath(value, "brand identity"));
	}
	assertEquals(heroSearchHref("all", "logo"), "/explore?q=logo");
	assertEquals(heroSearchHref("freelancers", "logo"), "/explore?category=freelancers&q=logo");
	assertEquals(heroSearchHref("projects", ""), "/explore?category=projects");
	assertEquals(heroSearchHref("all", "   "), "/explore");
	assertEquals(chipHref("landing page"), explorePath("all", "landing page"));
});
// #endregion

// #region Typewriter
Deno.test("hero-search: the typewriter is off under reduced motion, without terms or when not asked", () => {
	const terms = ["landing page"];
	assert(typewriterAllowed({ enabled: true, terms, motionAllowed: true }));
	assertFalse(typewriterAllowed({ enabled: true, terms, motionAllowed: false }));
	assertFalse(typewriterAllowed({ enabled: false, terms, motionAllowed: true }));
	assertFalse(typewriterAllowed({ enabled: true, terms: [], motionAllowed: true }));
});

Deno.test("hero-search: the typewriter types, holds and erases each term once", () => {
	const terms = ["ab", "c"];
	const frames: string[] = [];
	let state: TypewriterState = TYPEWRITER_START;
	let total = 0;
	for (let guard = 0; guard < 50 && state.phase !== "done"; guard++) {
		const step = typewriterStep(state, terms);
		total += step.delayMs;
		state = step.next;
		frames.push(`${state.phase}:${typewriterTyped(state, terms) ?? "-"}`);
	}
	assertEquals(frames, [
		"typing:a",
		"holding:ab",
		"erasing:ab",
		"erasing:a",
		"typing:",
		"holding:c",
		"erasing:c",
		"done:-",
	]);
	assertEquals(typewriterStep(state, terms).next, state);
	assert(total >= 2 * TYPEWRITER_TIMING.holdMs);
	assertEquals(typewriterSentence("brand"), "Try “brand”");
});

Deno.test("hero-search: a term's cycle is exactly the step model's delays, and a turn fits the longest", () => {
	for (const term of ["c", "landing page", "design mentorship block", "a".repeat(28)]) {
		// Ticks run at 0, then after each step's delay; the cycle ends on the frame with nothing left.
		let state: TypewriterState = TYPEWRITER_START;
		let at = 0;
		let ended = -1;
		for (let guard = 0; guard < 200 && ended < 0; guard++) {
			const step = typewriterStep(state, [term]);
			state = step.next;
			if (state.phase === "done") ended = at;
			at += step.delayMs;
		}
		assertEquals(ended, typewriterCycleMs(term), term);
		assert(typewriterTurnMs([term]) > typewriterCycleMs(term), term);
	}
	assertEquals(typewriterTurnMs([]), 0);
	// The default turn already fits a two-word term; a 28-character one asks for a longer turn.
	assert(typewriterTurnMs(["landing page"]) <= HERO_TIMING.typewriterMs);
	assert(typewriterTurnMs(["a".repeat(28)]) > HERO_TIMING.typewriterMs);
});

Deno.test("hero-search: below --bp-md the run stops after 5 seconds", () => {
	assertEquals(TYPEWRITER_TIMING.narrowCapMs, 5000);
	assertFalse(typewriterCapped(4999, true));
	assert(typewriterCapped(5000, true));
	assertFalse(typewriterCapped(60_000, false));
});
// #endregion

// #region Calls to action
Deno.test("hero-search: the calls to action follow the viewer table", () => {
	const hire = { label: "Hire a team", href: explorePath("teams") };
	assertEquals(heroCtas(GUEST_VIEWER), {
		hire,
		offer: { label: "Offer your skills", href: "/join?intent=freelancer" },
	});
	const client = heroViewerOf(true, { isFreelancer: false, restricted: false });
	assertEquals(heroCtas(client).offer, { label: "Offer your skills", href: "/become-partner" });
	const freelancer = heroViewerOf(true, { isFreelancer: true, restricted: false });
	assertEquals(heroCtas(freelancer).offer, { label: "Find work", href: explorePath("projects") });
	const minor = heroViewerOf(true, { isFreelancer: false, restricted: true });
	assertEquals(heroCtas(minor), { hire, offer: null });
	assertEquals(heroCtas(heroViewerOf(true, { isFreelancer: true, restricted: true })).offer, null);
	assertEquals(heroViewerOf(false, { isFreelancer: true, restricted: true }), GUEST_VIEWER);
	assertEquals(heroViewerOf(true, null), GUEST_VIEWER);
});
// #endregion

// #region Suggestions
const BRAND = answer({
	q: "brand",
	hits: [
		{
			id: "t1",
			type: "teams",
			title: "Brand Bureau",
			ownerName: "Brand Bureau",
			ownerHandle: "@bureau",
		},
		{
			id: "f1",
			type: "freelancers",
			title: "Ada Brand",
			ownerName: "Ada Brand",
			ownerHandle: "@ada",
		},
		{
			id: "s1",
			type: "services",
			title: "Brand identity sprint",
			ownerName: "Ada Brand",
			ownerHandle: "@ada",
			media: "/test_images/cover.jpg",
		},
		{ id: "p1", type: "projects", title: "Brand refresh", ownerName: "Loop", ownerHandle: "@loop" },
		{ id: "x1", type: "products", title: "Brand kit", ownerName: "Ada", ownerHandle: "@ada" },
	],
	handles: [{ handle: "@ada", name: "Ada Brand", avatar: "", kind: "freelancer", verified: false }],
});

Deno.test("hero-search: an empty field lists recent searches with Clear, then Trending", () => {
	const sections = suggestSections({
		typed: "",
		recent: ["logo", "deck"],
		trending: ["Webflow", "webflow", "Brand"],
		status: "idle",
		data: null,
	});
	assertEquals(sections.map((s) => [s.id, s.label]), [
		["recent", HERO_SEARCH_COPY.recent],
		["trending", HERO_SEARCH_COPY.trending],
	]);
	assertEquals(sections[0].rows, [
		{ kind: "recent", term: "logo" },
		{ kind: "recent", term: "deck" },
		{ kind: "clear-recent" },
	]);
	assertEquals(sections[1].rows.length, 2);
	assertEquals(
		suggestSections({ typed: "", recent: [], trending: null, status: "idle", data: null }),
		[],
	);
});

Deno.test("hero-search: typed results group into people & teams, services and projects", () => {
	const sections = suggestSections({
		typed: "brand",
		recent: matchRecent(["brand kit", "logo"], "brand"),
		trending: null,
		status: "ready",
		data: BRAND,
	});
	assertEquals(sections.map((s) => s.id), ["recent", "people", "services", "projects", "search"]);
	assertEquals(sections[0].rows, [{ kind: "recent", term: "brand kit" }]);
	assertEquals(sections[1].rows, [
		{ kind: "person", name: "Ada Brand", meta: "Freelancer", avatar: null, href: "/@ada" },
		{ kind: "person", name: "Brand Bureau", meta: "Team", avatar: null, href: "/@bureau" },
	]);
	assertEquals(sections[2].rows, [{
		kind: "listing",
		title: "Brand identity sprint",
		meta: "Ada Brand",
		media: "/test_images/cover.jpg",
		href: "/view/s1?type=services",
	}]);
	assertEquals(sections[3].rows[0], {
		kind: "listing",
		title: "Brand refresh",
		meta: "Loop",
		media: null,
		href: "/view/p1?type=projects",
	});
	assertEquals(sections[4].rows, [{ kind: "search", q: "brand", empty: false }]);
	assertFalse(
		flattenRows(sections).some((row) => row.kind === "listing" && row.title === "Brand kit"),
	);
	assertEquals(
		suggestAnnouncement(true, { typed: "brand", status: "ready" }, sections),
		"5 suggestions. Use the up and down arrows to choose.",
	);
});

Deno.test("hero-search: no matches, searching and failure rows and announcements", () => {
	const none = suggestSections({
		typed: "zzz",
		recent: [],
		trending: null,
		status: "ready",
		data: answer(),
	});
	assertEquals(none, [{
		id: "search",
		label: null,
		rows: [{ kind: "search", q: "zzz", empty: true }],
	}]);
	assertEquals(
		suggestAnnouncement(true, { typed: "zzz", status: "ready" }, none),
		"No matches for “zzz”. Search anyway",
	);
	const loading = suggestSections({
		typed: "zz",
		recent: [],
		trending: null,
		status: "loading",
		data: null,
	});
	assertEquals(flattenRows(loading), [{ kind: "search", q: "zz", empty: false }]);
	assertEquals(
		suggestAnnouncement(true, { typed: "zz", status: "loading" }, loading),
		"Searching…",
	);
	const failed = suggestSections({
		typed: "zz",
		recent: [],
		trending: null,
		status: "error",
		data: BRAND,
	});
	assertEquals(failed.map((s) => s.id), ["search"]);
	assertEquals(
		suggestAnnouncement(true, { typed: "zz", status: "error" }, failed),
		HERO_SEARCH_COPY.failed,
	);
	assertEquals(suggestAnnouncement(false, { typed: "zz", status: "error" }, failed), "");
});

Deno.test("hero-search: the arrow keys wrap through the rows", () => {
	assertEquals(moveActive(-1, 3, 1), 0);
	assertEquals(moveActive(-1, 3, -1), 2);
	assertEquals(moveActive(2, 3, 1), 0);
	assertEquals(moveActive(0, 3, -1), 2);
	assertEquals(moveActive(0, 0, 1), -1);
});
// #endregion
