import { assertEquals } from "@std/assert";
import {
	readItemParam,
	RESULTS_RAIL_CAP,
	resultOrder,
	stepFromKey,
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

Deno.test("stepFromKey follows the reading direction and ignores modified presses", () => {
	assertEquals(stepFromKey({ ...KEY, key: "ArrowRight" }), 1);
	assertEquals(stepFromKey({ ...KEY, key: "ArrowLeft" }), -1);
	assertEquals(stepFromKey({ ...KEY, key: "ArrowLeft" }, "rtl"), 1);
	assertEquals(stepFromKey({ ...KEY, key: "ArrowRight", altKey: true }), null);
	assertEquals(stepFromKey({ ...KEY, key: "ArrowDown" }), null);
});
