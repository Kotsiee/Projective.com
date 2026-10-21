import { assertEquals, assertNotEquals } from "@std/assert";
import {
	CONSOLE_DEFAULTS,
	consoleHref,
	type ConsoleUrlState,
	EMPTY_FACET_COUNTS,
	parseConsoleUrl,
} from "../types/catalogue-types.ts";
import type { CataloguePage, ListingSummary } from "../types/catalogue-types.ts";
import {
	canonicalConsoleUrl,
	clearSelection,
	consoleLocation,
	consoleUrl,
	highlightsWith,
	listingsPage,
	listParamsOf,
	listQueryKey,
	mergeConsoleUrl,
	NO_QUICK_FILTERS,
	quickFiltersOf,
	rangeBetween,
	reduceSelection,
	selectAll,
	selection,
	selectionAnchor,
	type SelectionState,
	setConsoleUrl,
	toggleSelect,
} from "./console-store.ts";

const BASE: ConsoleUrlState = { ...CONSOLE_DEFAULTS };
const ORDER = ["svc-a", "svc-b", "svc-c", "svc-d", "svc-e"];
const NONE: SelectionState = { selected: new Set(), anchor: null };

function selected(state: SelectionState): string[] {
	return [...state.selected].sort();
}

// #region URL merging
Deno.test("a new sort key opens in its natural direction; a named direction is kept", () => {
	assertEquals(mergeConsoleUrl(BASE, { sort: "title" }).dir, "asc");
	assertEquals(mergeConsoleUrl(BASE, { sort: "views" }).dir, "desc");
	assertEquals(mergeConsoleUrl(BASE, { sort: "title", dir: "desc" }).dir, "desc");
	const titled = mergeConsoleUrl(BASE, { sort: "title" });
	assertEquals(mergeConsoleUrl(titled, { dir: "desc" }), { ...titled, dir: "desc" });
});

Deno.test("a product scope drops the delivery-model facet", () => {
	const modelled = mergeConsoleUrl(BASE, { model: ["Pipeline", "Session"] });
	assertEquals(modelled.model, ["Pipeline", "Session"]);
	assertEquals(mergeConsoleUrl(modelled, { type: "product" }).model, []);
	assertEquals(mergeConsoleUrl(modelled, { type: "service" }).model, ["Pipeline", "Session"]);
});

Deno.test("the client drawer exists only on the clients view", () => {
	const drawer = mergeConsoleUrl(BASE, { view: "clients", client: "@ada_lin" });
	assertEquals(drawer.client, "@ada_lin");
	assertEquals(mergeConsoleUrl(drawer, { view: "listings" }).client, undefined);
});

Deno.test("closing the create modal drops its seed", () => {
	const open = mergeConsoleUrl(BASE, {
		createOpen: true,
		createKind: "service",
		createModel: "Session",
	});
	assertEquals(consoleHref(open), "/catalogue?create=service:session");
	const closed = mergeConsoleUrl(open, { createOpen: false });
	assertEquals([closed.createOpen, closed.createKind, closed.createModel], [
		false,
		undefined,
		undefined,
	]);
	assertEquals(consoleHref(closed), "/catalogue");
});

Deno.test("clearing a facet removes it from the address", () => {
	const faceted = mergeConsoleUrl(BASE, { status: ["draft", "archived"], create: ["educate"] });
	assertEquals(consoleHref(faceted), "/catalogue?status=draft,archived&category=educate");
	assertEquals(
		consoleHref(mergeConsoleUrl(faceted, { status: [] })),
		"/catalogue?category=educate",
	);
	assertEquals(
		consoleHref(mergeConsoleUrl(faceted, { create: [] })),
		"/catalogue?status=draft,archived",
	);
});

Deno.test("the console opens on every status but Archived", () => {
	assertEquals(BASE.status, ["draft", "published", "paused"]);
	assertEquals(listParamsOf(BASE).status, ["draft", "published", "paused"]);
});

Deno.test("a merged state is canonical: its own href parses back to it", () => {
	const patches: Partial<ConsoleUrlState>[] = [
		{ view: "analytics", period: "12m" },
		{ type: "service", model: ["Group Session"], status: ["paused", "draft"], sort: "price" },
		{ search: "  brand sprint  ", create: ["advise", "run"], scope: "collection:starter-kits" },
		{ view: "clients", client: "@ada_lin", dir: "asc" },
	];
	for (const patch of patches) {
		const state = mergeConsoleUrl(BASE, patch);
		assertEquals(parseConsoleUrl(new URL(consoleHref(state), "https://x.test")), state);
		assertEquals(canonicalConsoleUrl(state), state);
	}
});

Deno.test("the address keeps parameters the console does not own", () => {
	const state = mergeConsoleUrl(BASE, { status: ["draft"] });
	assertEquals(
		consoleLocation(state, "?status=published&tkv=tkt-23456789ab"),
		"/catalogue?status=draft&tkv=tkt-23456789ab",
	);
	assertEquals(consoleLocation(BASE, "?tkv=tkt-23456789ab"), "/catalogue?tkv=tkt-23456789ab");
	assertEquals(consoleLocation(state, "?search=old&sort=title"), "/catalogue?status=draft");
});
// #endregion

// #region Listings query
Deno.test("list params follow the URL, its highlights included", () => {
	const state = mergeConsoleUrl(BASE, {
		type: "service",
		model: ["Pipeline"],
		create: ["run"],
		highlights: ["best-selling", "attention"],
		status: ["published"],
		search: "logo",
		sort: "price",
		period: "12m",
	});
	assertEquals(
		listParamsOf(state, "svc-x"),
		{
			type: "service",
			status: ["published"],
			model: ["Pipeline"],
			createCategory: ["run"],
			search: "logo",
			sort: "price",
			dir: "asc",
			period: "12m",
			needsAttention: true,
			promoted: undefined,
			bestSelling: true,
			cursor: "svc-x",
			limit: 60,
		},
	);
	assertEquals(listParamsOf(BASE).search, undefined);
});

Deno.test("the read key ignores what does not change the listings read", () => {
	const key = listQueryKey(BASE);
	assertEquals(listQueryKey(mergeConsoleUrl(BASE, { view: "analytics" })), key);
	assertEquals(listQueryKey(mergeConsoleUrl(BASE, { createOpen: true })), key);
	assertNotEquals(listQueryKey(mergeConsoleUrl(BASE, { status: ["draft"] })), key);
	assertNotEquals(listQueryKey(mergeConsoleUrl(BASE, { highlights: ["promoted"] })), key);
	assertEquals(listQueryKey(mergeConsoleUrl(BASE, { team: "north-loop" })), key);
});

Deno.test("the quick filters are the highlight facet, toggled one at a time", () => {
	assertEquals(quickFiltersOf([]), NO_QUICK_FILTERS);
	assertEquals(quickFiltersOf(["best-selling"]), { ...NO_QUICK_FILTERS, bestSelling: true });
	assertEquals(highlightsWith(["attention"], "bestSelling", true), ["attention", "best-selling"]);
	assertEquals(highlightsWith(["attention", "promoted"], "attention", false), ["promoted"]);
	assertEquals(highlightsWith(["promoted"], "promoted", true), ["promoted"]);
	assertEquals(
		canonicalConsoleUrl({ highlights: highlightsWith([], "bestSelling", true) }).highlights,
		["best-selling"],
	);
});

Deno.test("a team console keeps its team through every merge", () => {
	const team = canonicalConsoleUrl({ team: "north-loop" });
	assertEquals(mergeConsoleUrl(team, { view: "clients", status: ["draft"] }).team, "north-loop");
	assertEquals(
		consoleLocation(mergeConsoleUrl(team, { highlights: ["promoted"] }), "?tkv=tkt-1"),
		"/teams/north-loop/catalogue?highlight=promoted&tkv=tkt-1",
	);
});
// #endregion

// #region Selection reducer
Deno.test("a range runs between anchor and target in shown order, either way round", () => {
	assertEquals(rangeBetween(ORDER, "svc-b", "svc-d"), ["svc-b", "svc-c", "svc-d"]);
	assertEquals(rangeBetween(ORDER, "svc-d", "svc-b"), ["svc-b", "svc-c", "svc-d"]);
	assertEquals(rangeBetween(ORDER, "svc-z", "svc-b"), ["svc-b"]);
});

Deno.test("a plain toggle flips one listing and moves the anchor", () => {
	const on = reduceSelection(NONE, { type: "toggle", id: "svc-b", order: ORDER });
	assertEquals([selected(on), on.anchor], [["svc-b"], "svc-b"]);
	const off = reduceSelection(on, { type: "toggle", id: "svc-b", order: ORDER });
	assertEquals([selected(off), off.anchor], [[], "svc-b"]);
});

Deno.test("a shift toggle selects the range from the anchor and keeps the anchor", () => {
	const first = reduceSelection(NONE, { type: "toggle", id: "svc-b", order: ORDER });
	const range = reduceSelection(first, { type: "toggle", id: "svc-d", order: ORDER, range: true });
	assertEquals(selected(range), ["svc-b", "svc-c", "svc-d"]);
	assertEquals(range.anchor, "svc-b");
	const back = reduceSelection(range, { type: "toggle", id: "svc-a", order: ORDER, range: true });
	assertEquals(selected(back), ["svc-a", "svc-b", "svc-c", "svc-d"]);
});

Deno.test("a shift toggle on a selected target clears the range", () => {
	const all = reduceSelection({ selected: new Set(ORDER), anchor: "svc-a" }, {
		type: "toggle",
		id: "svc-c",
		order: ORDER,
		range: true,
	});
	assertEquals(selected(all), ["svc-d", "svc-e"]);
});

Deno.test("a shift toggle without a shown anchor is a plain toggle", () => {
	const lone = reduceSelection({ selected: new Set(), anchor: "svc-gone" }, {
		type: "toggle",
		id: "svc-c",
		order: ORDER,
		range: true,
	});
	assertEquals([selected(lone), lone.anchor], [["svc-c"], "svc-c"]);
});

Deno.test("all, clear and keep", () => {
	const all = reduceSelection(NONE, { type: "all", order: ORDER });
	assertEquals(selected(all), ORDER);
	assertEquals(reduceSelection(all, { type: "clear" }), NONE);
	const anchored = { selected: new Set(["svc-a", "svc-c"]), anchor: "svc-a" };
	const kept = reduceSelection(anchored, { type: "keep", ids: ["svc-c", "svc-d"] });
	assertEquals([selected(kept), kept.anchor], [["svc-c"], null]);
});
// #endregion

// #region Store actions
function listing(id: string): ListingSummary {
	return {
		id,
		ownerId: "@seller",
		kind: "service",
		serviceType: "One-Off",
		title: id,
		category: "",
		status: "draft",
		currency: "USD",
		cover: null,
		price: { mode: "quote", display: "Set a price" },
		metrics: {
			views: 0,
			orders: 0,
			revenue: 0,
			revenueLabel: "",
			avgRating: 0,
			ratingCount: 0,
			trend: [],
		},
		updatedAt: "2026-10-14T00:00:00.000Z",
		updatedLabel: "Edited today",
		promoted: false,
		needsAttention: false,
		deletable: false,
	};
}

function page(ids: readonly string[]): CataloguePage {
	return {
		items: ids.map(listing),
		hasMore: false,
		nextCursor: null,
		total: ids.length,
		statusCounts: { draft: ids.length, published: 0, paused: 0, archived: 0 },
		facetCounts: EMPTY_FACET_COUNTS,
		stats: {
			activeListings: 0,
			totalListings: ids.length,
			views: 0,
			period: "30d",
			asOf: null,
			orders: 0,
			revenue: 0,
			revenueLabel: "",
			revenueChange: null,
			conversion: null,
			avgRating: 0,
		},
		viewerId: "@seller",
	};
}

function seed(ids: readonly string[]): void {
	listingsPage.value = page(ids);
	clearSelection();
	consoleUrl.value = { ...CONSOLE_DEFAULTS };
}

Deno.test("toggleSelect ranges over the listings as shown", () => {
	seed(ORDER);
	toggleSelect("svc-e");
	toggleSelect("svc-c", true);
	assertEquals([...selection.value].sort(), ["svc-c", "svc-d", "svc-e"]);
	assertEquals(selectionAnchor.value, "svc-e");
	selectAll();
	assertEquals(selection.value.size, ORDER.length);
});

Deno.test("leaving the listings view clears the selection", () => {
	seed(ORDER);
	selectAll();
	setConsoleUrl({ view: "analytics" });
	assertEquals(consoleUrl.value.view, "analytics");
	assertEquals(selection.value.size, 0);
});
// #endregion
