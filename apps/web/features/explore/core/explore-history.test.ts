import { assertEquals } from "@std/assert";
import {
	backLabel,
	backTarget,
	ensureTop,
	EXPLORE_FALLBACK,
	HISTORY_BREAK,
	HISTORY_MAX,
	isExploreUrl,
	parseStack,
	retop,
	returnTo,
	urlOf,
	visit,
} from "./explore-history.ts";
import { profileHandleOf } from "./routing.ts";

// #region Eligibility
Deno.test("isExploreUrl — the tree is /explore, /view and the /@handle namespace, query included", () => {
	assertEquals(isExploreUrl("/explore"), true);
	assertEquals(isExploreUrl("/explore?category=design&price=100,500"), true);
	assertEquals(isExploreUrl("/view/sv-brand-identity-sprint?type=services"), true);
	assertEquals(isExploreUrl("/@juno"), true);
	assertEquals(isExploreUrl("/@juno/reviews?as=client"), true);
	assertEquals(isExploreUrl("/@juno/view/pr-juno-1"), true);
	assertEquals(isExploreUrl("/@juno/availability"), true);
	assertEquals(isExploreUrl("/%40juno"), true);
});

Deno.test("isExploreUrl — everything else is outside the tree", () => {
	for (
		const url of [
			"/",
			"/projects",
			"/projects/prj-abc/board",
			"/messages",
			"/explorer",
			"/viewer",
			"/@",
		]
	) {
		assertEquals(isExploreUrl(url), false, url);
	}
});

Deno.test("profileHandleOf — the bare lower-cased handle, or null", () => {
	assertEquals(profileHandleOf("/@Juno/reviews"), "juno");
	assertEquals(profileHandleOf("/%40kenji"), "kenji");
	assertEquals(profileHandleOf("/explore"), null);
	assertEquals(profileHandleOf("/"), null);
	assertEquals(profileHandleOf("/@"), null);
});

Deno.test("urlOf — pathname and search, nothing else", () => {
	assertEquals(urlOf({ pathname: "/explore", search: "?q=design" }), "/explore?q=design");
	assertEquals(urlOf({ pathname: "/@juno", search: "" }), "/@juno");
});
// #endregion

// #region Forward visits
Deno.test("visit — an eligible page pushes, a repeat of the top does not", () => {
	const a = visit([], "/explore?category=design");
	assertEquals(a, ["/explore?category=design"]);
	assertEquals(visit(a, "/explore?category=design"), a);
	assertEquals(visit(a, "/@juno"), ["/explore?category=design", "/@juno"]);
});

Deno.test("visit — a page outside the tree records one break, never two, and none at the start", () => {
	assertEquals(visit([], "/projects"), []);
	const chain = ["/explore", "/@juno"];
	const broken = visit(chain, "/projects");
	assertEquals(broken, ["/explore", "/@juno", HISTORY_BREAK]);
	assertEquals(visit(broken, "/messages"), broken);
});

Deno.test("visit — a forward link to an earlier page is a NEW step, not a return", () => {
	const stack = ["/@juno", "/@kenji"];
	assertEquals(visit(stack, "/@juno"), ["/@juno", "/@kenji", "/@juno"]);
});

Deno.test("visit — the stack is capped from the OLD end", () => {
	let stack: string[] = [];
	for (let i = 0; i < HISTORY_MAX + 5; i++) stack = visit(stack, `/view/item-${i}`);
	assertEquals(stack.length, HISTORY_MAX);
	assertEquals(stack[0], "/view/item-5");
	assertEquals(stack[stack.length - 1], `/view/item-${HISTORY_MAX + 4}`);
});
// #endregion

// #region Returns
Deno.test("returnTo — walks the stack back to the entry, discarding what was above it", () => {
	const stack = ["/explore?q=a", "/@juno", "/@juno/view/pr-1", HISTORY_BREAK];
	assertEquals(returnTo(stack, "/@juno"), ["/explore?q=a", "/@juno"]);
	assertEquals(returnTo(stack, "/explore?q=a"), ["/explore?q=a"]);
});

Deno.test("returnTo — a URL the stack never held is a forward visit", () => {
	assertEquals(returnTo(["/explore"], "/@ivy"), ["/explore", "/@ivy"]);
	assertEquals(returnTo([], "/@ivy"), ["/@ivy"]);
});

Deno.test("returnTo — the break marker is never a return target", () => {
	assertEquals(returnTo(["/explore", HISTORY_BREAK], HISTORY_BREAK), ["/explore", HISTORY_BREAK]);
});

Deno.test("ensureTop — a reload leaves a stack whose top is the page alone", () => {
	assertEquals(ensureTop(["/explore", "/@juno"], "/@juno"), ["/explore", "/@juno"]);
	assertEquals(ensureTop(["/explore"], "/@juno"), ["/explore", "/@juno"]);
});
// #endregion

// #region In-place URL changes
Deno.test("retop — re-records the entry with the URL the page left with", () => {
	const stack = ["/explore", "/@juno/reviews"];
	assertEquals(retop(stack, 1, "/@juno/reviews?as=client"), [
		"/explore",
		"/@juno/reviews?as=client",
	]);
	assertEquals(retop(stack, 0, "/explore?category=design"), [
		"/explore?category=design",
		"/@juno/reviews",
	]);
});

Deno.test("retop — a break stays a break, a page never becomes one, and a bad index is a no-op", () => {
	const stack = ["/explore", HISTORY_BREAK];
	assertEquals(retop(stack, 1, "/@juno"), stack);
	assertEquals(retop(stack, 0, "/projects"), stack);
	assertEquals(retop(stack, 5, "/@juno"), stack);
	assertEquals(retop(stack, -1, "/@juno"), stack);
});
// #endregion

// #region Back target
Deno.test("backTarget — the previous page of the tree, filters intact", () => {
	const stack = ["/explore?category=design&price=100,500", "/@juno", "/@juno/view/pr-1"];
	assertEquals(backTarget(stack, 2), "/@juno");
	assertEquals(backTarget(stack, 1), "/explore?category=design&price=100,500");
});

Deno.test("backTarget — the tree's root when there is nothing beneath, or a break beneath", () => {
	assertEquals(backTarget(["/@juno"], 0), EXPLORE_FALLBACK);
	assertEquals(backTarget(["/explore", HISTORY_BREAK, "/@juno"], 2), EXPLORE_FALLBACK);
	assertEquals(backTarget([], -1), EXPLORE_FALLBACK);
	assertEquals(backTarget(["/@juno"], 0, "/@juno"), "/@juno");
});

Deno.test("backTarget — the browser's Back then Back again unwinds the whole chain", () => {
	let stack = visit([], "/explore?q=brand");
	stack = visit(stack, "/@juno");
	stack = visit(stack, "/@juno/view/sv-1?type=services");
	// Back from the listing → the profile.
	const first = backTarget(stack, 2);
	assertEquals(first, "/@juno");
	stack = returnTo(stack, first);
	// Back from the profile → the search, with its query.
	const second = backTarget(stack, 1);
	assertEquals(second, "/explore?q=brand");
	stack = returnTo(stack, second);
	assertEquals(stack, ["/explore?q=brand"]);
});

Deno.test("backTarget — an excursion outside the tree is bridged by the browser's own Back", () => {
	let stack = visit([], "/explore?q=brand");
	stack = visit(stack, "/@juno");
	stack = visit(stack, "/checkout");
	assertEquals(stack, ["/explore?q=brand", "/@juno", HISTORY_BREAK]);
	// The browser's Back lands on the profile again: the chain behind it is intact.
	stack = returnTo(stack, "/@juno");
	assertEquals(backTarget(stack, 1), "/explore?q=brand");
});
// #endregion

// #region Labels + parsing
Deno.test("backLabel — names the destination the visible word cannot", () => {
	assertEquals(backLabel("/explore?category=design"), "Back to Explore");
	assertEquals(backLabel("/@juno/reviews"), "Back to @juno");
	assertEquals(backLabel("/view/sv-1?type=services"), "Back to the listing");
	assertEquals(backLabel("/projects"), "Back");
});

Deno.test("parseStack — malformed storage reads as empty", () => {
	assertEquals(parseStack(null), []);
	assertEquals(parseStack("not json"), []);
	assertEquals(parseStack('{"a":1}'), []);
	assertEquals(parseStack('["/explore", 3, null, "/@juno"]'), ["/explore", "/@juno"]);
});
// #endregion
