import { assertEquals } from "@std/assert";
import type { ListingSummary } from "@projective/types/catalogue";
import {
	catalogueCommit,
	filterTeamListings,
	matchLabel,
	NO_CATALOGUE_FILTER,
	statusFilterOptions,
	TEAM_CATALOGUE_PARAMS,
	teamCatalogueView,
	teamListingHref,
} from "./catalogue-module-model.ts";

/** A team console's Catalogue module — its pure decisions (Decision #308). */

function listing(
	id: string,
	status: ListingSummary["status"],
	title: string,
	category = "Design",
): ListingSummary {
	return { id, kind: "service", status, title, category } as ListingSummary;
}

const ITEMS = [
	listing("svc-brand", "published", "Brand identity"),
	listing("svc-site", "draft", "Marketing site", "Web"),
	listing("prd-kit", "paused", "Icon kit", "Assets"),
	listing("svc-old", "archived", "Old retainer"),
];

Deno.test("the module reads every listing the team has, newest edit first, in one page", () => {
	assertEquals(TEAM_CATALOGUE_PARAMS, { type: "all", sort: "recent", limit: 200 });
});

Deno.test("no narrowing shows every listing, in order", () => {
	assertEquals(filterTeamListings(ITEMS, NO_CATALOGUE_FILTER).map((l) => l.id), [
		"svc-brand",
		"svc-site",
		"prd-kit",
		"svc-old",
	]);
});

Deno.test("narrowing by status keeps that lifecycle state only", () => {
	assertEquals(
		filterTeamListings(ITEMS, { status: "draft", search: "" }).map((l) => l.id),
		["svc-site"],
	);
});

Deno.test("search matches title or category, case-insensitively, trimmed, within the status", () => {
	assertEquals(filterTeamListings(ITEMS, { status: "all", search: "  WEB " }).map((l) => l.id), [
		"svc-site",
	]);
	assertEquals(filterTeamListings(ITEMS, { status: "all", search: "kit" }).map((l) => l.id), [
		"prd-kit",
	]);
	assertEquals(filterTeamListings(ITEMS, { status: "published", search: "kit" }), []);
});

Deno.test("the status options carry their counts and drop empty states unless chosen", () => {
	const counts = { draft: 2, published: 3, paused: 0, archived: 1 };
	assertEquals(statusFilterOptions(counts), [
		{ label: "All (6)", value: "all" },
		{ label: "Published (3)", value: "published" },
		{ label: "Drafts (2)", value: "draft" },
		{ label: "Archived (1)", value: "archived" },
	]);
	assertEquals(
		statusFilterOptions(counts, "paused").some((o) => o.value === "paused"),
		true,
	);
});

Deno.test("the count says how many of how many when narrowed", () => {
	assertEquals(matchLabel(4, 4), "4 listings");
	assertEquals(matchLabel(1, 1), "1 listing");
	assertEquals(matchLabel(1, 4), "1 of 4");
});

Deno.test("acting as the team, every card opens its manage page", () => {
	assertEquals(teamListingHref(ITEMS[1], true), "/catalogue/svc-site");
	assertEquals(teamListingHref(ITEMS[0], true), "/catalogue/svc-brand");
});

Deno.test("acting as oneself, a published card opens its public page and the rest link nowhere", () => {
	assertEquals(teamListingHref(ITEMS[0], false), "/view/svc-brand?type=services");
	assertEquals(teamListingHref(ITEMS[1], false), null);
	assertEquals(teamListingHref(ITEMS[2], false), null);
});

Deno.test("the switch is explained only to a member acting as themselves", () => {
	assertEquals(teamCatalogueView({ name: "Atelier Nova", acting: true }).actingNote, null);
	assertEquals(
		teamCatalogueView({ name: "Atelier Nova", acting: false }).actingNote,
		"You're acting as yourself. Act as Atelier Nova to add or edit its listings — anything you create now is filed under your own name.",
	);
});

Deno.test("New listing is the header band's tier-2 commit, only while acting as the team", () => {
	assertEquals(catalogueCommit(true), { key: "new-listing", label: "New listing", tier: 2 });
	assertEquals(catalogueCommit(false), null);
});
