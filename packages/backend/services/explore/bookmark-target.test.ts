import { assertEquals } from "jsr:@std/assert@^1";
import {
	type BookmarkCatalog,
	bookmarkTarget,
	itemIdsByTarget,
	targetKey,
} from "./bookmark-target.ts";

const catalog: BookmarkCatalog = {
	byId: new Map([
		["logo-sprint", { type: "services" }],
		["brand-refresh", { type: "projects" }],
		["chloewinters", { type: "freelancers" }],
		["north-studio", { type: "teams" }],
		["juno", { type: "users" }],
		["icon-pack", { type: "products" }],
		["pricing-guide", { type: "articles" }],
		["orphan-service", { type: "services" }],
	]),
	blueprintBySlug: new Map([["logo-sprint", { id: "bp-1" }]]),
	projectBySlug: new Map([["brand-refresh", { row: { id: "pj-1" } }]]),
	profileByHandle: new Map([
		["@chloewinters", { entity_id: "u-1", entity_type: "freelancer" }],
		["@north-studio", { entity_id: "t-1", entity_type: "team" }],
		["@juno", { entity_id: "u-2", entity_type: "user" }],
	]),
};

Deno.test("bookmarkTarget: saveable items resolve to their org.user_bookmarks row", () => {
	assertEquals(bookmarkTarget(catalog, "logo-sprint"), { kind: "service_blueprint", id: "bp-1" });
	assertEquals(bookmarkTarget(catalog, "brand-refresh"), { kind: "project", id: "pj-1" });
	assertEquals(bookmarkTarget(catalog, "chloewinters"), { kind: "freelancer", id: "u-1" });
	assertEquals(bookmarkTarget(catalog, "north-studio"), { kind: "team", id: "t-1" });
});

Deno.test("bookmarkTarget: products, articles, buyers and unknown ids cannot be saved", () => {
	assertEquals(bookmarkTarget(catalog, "icon-pack"), null);
	assertEquals(bookmarkTarget(catalog, "pricing-guide"), null);
	assertEquals(bookmarkTarget(catalog, "juno"), null);
	assertEquals(bookmarkTarget(catalog, "orphan-service"), null);
	assertEquals(bookmarkTarget(catalog, "not-in-catalogue"), null);
});

Deno.test("itemIdsByTarget: maps every saveable row back to its discovery id", () => {
	const map = itemIdsByTarget(catalog);
	assertEquals(map.size, 4);
	assertEquals(map.get(targetKey("service_blueprint", "bp-1")), "logo-sprint");
	assertEquals(map.get(targetKey("team", "t-1")), "north-studio");
});
