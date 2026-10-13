import { assertEquals } from "@std/assert";
import {
	adjacentScope,
	DETAIL_JUMP,
	detailKeyIntent,
	DRAWER_SCOPES,
	readItemParam,
	resultOrder,
	RESULTS_RAIL_CAP,
	scopeOf,
	sectionJumpTarget,
	stepIndex,
	stepPosition,
	withItemParam,
} from "./detail-nav.ts";
import { parseExploreParams } from "./explore-state.ts";
import type { ExploreItem, ResultGroup } from "../types/explore-types.ts";

/** A minimal item of `type`; only `id` and `type` matter to the reading order. */
function item(id: string, type: ExploreItem["type"] = "services"): ExploreItem {
	return { id, type } as ExploreItem;
}

function group(key: string, items: ExploreItem[]): ResultGroup {
	return { key, items } as ResultGroup;
}

const KEY = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

Deno.test("readItemParam reads a slug or handle and drops anything else", () => {
	assertEquals(readItemParam("?q=logo&item=sv-brand-sprint"), "sv-brand-sprint");
	assertEquals(readItemParam("?item=juno.studio"), "juno.studio");
	assertEquals(readItemParam("?q=logo"), null);
	assertEquals(readItemParam("?item="), null);
	assertEquals(readItemParam("?item=%3Cscript%3E"), null);
	assertEquals(readItemParam(`?item=${"a".repeat(129)}`), null);
});

Deno.test("withItemParam sets and strips the item, keeping every other param and the hash", () => {
	assertEquals(
		withItemParam("/explore?q=logo&category=services#top", "sv-a"),
		"/explore?q=logo&category=services&item=sv-a#top",
	);
	assertEquals(withItemParam("/explore?q=logo&item=sv-a", "sv-b"), "/explore?q=logo&item=sv-b");
	assertEquals(withItemParam("/explore?q=logo&item=sv-a", null), "/explore?q=logo");
	assertEquals(withItemParam("/explore?item=sv-a", null), "/explore");
});

Deno.test("the item param is never read as a filter facet", () => {
	assertEquals(parseExploreParams("?q=logo&item=sv-a").filters, {});
});

Deno.test("resultOrder follows the isolated feed as loaded, skipping articles", () => {
	const feed = [item("a"), item("b", "articles"), item("c")];
	assertEquals(
		resultOrder({ isolated: true, groups: [] }, feed).map((it) => it.id),
		["a", "c"],
	);
});

Deno.test("resultOrder walks merged sections in order, capped and de-duplicated", () => {
	const long = Array.from({ length: RESULTS_RAIL_CAP + 3 }, (_, i) => item(`s${i}`));
	const order = resultOrder({
		isolated: false,
		groups: [group("services", long), group("projects", [item("s0"), item("p1", "projects")])],
	}, []);
	assertEquals(order.length, RESULTS_RAIL_CAP + 1);
	assertEquals(order.at(-1)?.id, "p1");
});

Deno.test("stepPosition names neighbours and stops at both ends", () => {
	const order = [item("a"), item("b"), item("c")];
	assertEquals(stepPosition(order, "a")?.prev, null);
	assertEquals(stepPosition(order, "a")?.next?.id, "b");
	assertEquals(stepPosition(order, "c")?.next, null);
	assertEquals(stepPosition(order, "b")?.index, 1);
	assertEquals(stepPosition(order, "b")?.total, 3);
	assertEquals(stepPosition(order, "zz"), null);
});

Deno.test("detailKeyIntent steps with the arrows in the reading direction", () => {
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowRight" }), { kind: "step", delta: 1 });
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowLeft" }), { kind: "step", delta: -1 });
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowLeft" }, "rtl"), { kind: "step", delta: 1 });
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowRight", altKey: true }), null);
});

Deno.test("detailKeyIntent skips five with Shift and changes section with Ctrl or Cmd", () => {
	assertEquals(
		detailKeyIntent({ ...KEY, key: "ArrowRight", shiftKey: true }),
		{ kind: "step", delta: DETAIL_JUMP },
	);
	assertEquals(
		detailKeyIntent({ ...KEY, key: "ArrowLeft", shiftKey: true }),
		{ kind: "step", delta: -DETAIL_JUMP },
	);
	assertEquals(
		detailKeyIntent({ ...KEY, key: "ArrowRight", ctrlKey: true }),
		{ kind: "section", dir: 1 },
	);
	assertEquals(
		detailKeyIntent({ ...KEY, key: "ArrowLeft", metaKey: true }),
		{ kind: "section", dir: -1 },
	);
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowRight", ctrlKey: true, metaKey: true }), null);
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowRight", ctrlKey: true, shiftKey: true }), null);
});

Deno.test("detailKeyIntent scrolls with the vertical arrows and opens with a bare Enter", () => {
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowDown" }), { kind: "scroll", dir: 1 });
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowUp" }), { kind: "scroll", dir: -1 });
	assertEquals(detailKeyIntent({ ...KEY, key: "Enter" }), { kind: "open" });
	assertEquals(detailKeyIntent({ ...KEY, key: "Enter", shiftKey: true }), null);
	assertEquals(detailKeyIntent({ ...KEY, key: "ArrowDown", ctrlKey: true }), null);
	assertEquals(detailKeyIntent({ ...KEY, key: "Tab" }), null);
});

Deno.test("stepIndex clamps a skip to either end and reports no move at the boundary", () => {
	assertEquals(stepIndex(2, DETAIL_JUMP, 20), 7);
	assertEquals(stepIndex(17, DETAIL_JUMP, 20), 19);
	assertEquals(stepIndex(3, -DETAIL_JUMP, 20), 0);
	assertEquals(stepIndex(19, 1, 20), null);
	assertEquals(stepIndex(0, -DETAIL_JUMP, 20), null);
});

Deno.test("scopeOf folds teams and businesses into their shared scopes", () => {
	assertEquals(scopeOf("teams"), "freelancers");
	assertEquals(scopeOf("businesses"), "users");
	assertEquals(scopeOf("services"), "services");
});

Deno.test("adjacentScope loops through the scope menu's order without articles", () => {
	assertEquals([...DRAWER_SCOPES], ["freelancers", "users", "services", "products", "projects"]);
	assertEquals(adjacentScope("services", 1), "products");
	assertEquals(adjacentScope("projects", 1), "freelancers");
	assertEquals(adjacentScope("freelancers", -1), "projects");
	assertEquals(adjacentScope("teams", 1), "users");
	assertEquals(adjacentScope("all", 1), "freelancers");
	assertEquals(adjacentScope("all", -1), "projects");
});

Deno.test("sectionJumpTarget lands on the first item of the neighbouring section, looping", () => {
	const order = [
		item("s1"),
		item("s2"),
		item("f1", "freelancers"),
		item("t1", "teams"),
		item("p1", "projects"),
	];
	assertEquals(sectionJumpTarget(order, 1, 1)?.id, "f1");
	assertEquals(sectionJumpTarget(order, 3, 1)?.id, "p1");
	assertEquals(sectionJumpTarget(order, 4, 1)?.id, "s1");
	assertEquals(sectionJumpTarget(order, 3, -1)?.id, "s1");
	assertEquals(sectionJumpTarget(order, 0, -1)?.id, "p1");
	assertEquals(sectionJumpTarget([item("a"), item("b")], 0, 1), null);
});
