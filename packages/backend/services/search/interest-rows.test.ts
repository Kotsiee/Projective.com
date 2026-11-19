import { assertEquals } from "@std/assert";
import type { DiscoveryEventBatch } from "@projective/types/explore";
import { type EntityLookup, EVENT_WEIGHT, toInterestRows } from "./interest-rows.ts";

const lookup: EntityLookup = (itemId) =>
	itemId === "logo-design"
		? { entityId: "11111111-1111-1111-1111-111111111111", entityType: "service" }
		: null;

const batch = (events: DiscoveryEventBatch["events"], query?: string): DiscoveryEventBatch => ({
	sessionId: "session-0001",
	surface: "explore.results",
	query,
	events,
});

Deno.test("an impression resolves its public id to the entity uuid and carries its slot", () => {
	const { rows, dropped } = toInterestRows(
		lookup,
		batch([{
			name: "discovery.impression",
			itemId: "logo-design",
			itemType: "services",
			rail: "services",
			position: 3,
			at: 1,
		}], "  logos "),
	);
	assertEquals(dropped, 0);
	assertEquals(rows, [{
		session_id: "session-0001",
		event_type: "impression",
		entity_id: "11111111-1111-1111-1111-111111111111",
		entity_type: "service",
		query: "logos",
		weight: EVENT_WEIGHT.impression,
		context: { surface: "explore.results", rail: "services", position: 3 },
	}]);
});

Deno.test("an id outside the public catalogue is dropped, not stored", () => {
	const { rows, dropped } = toInterestRows(
		lookup,
		batch([
			{ name: "discovery.click", itemId: "nope", itemType: "services", at: 1 },
			{ name: "discovery.click", itemId: "logo-design", itemType: "projects", at: 2 },
		]),
	);
	assertEquals(dropped, 1);
	assertEquals(rows.length, 1);
	assertEquals(rows[0].event_type, "click");
	assertEquals(rows[0].entity_type, "service");
	assertEquals(rows[0].weight, 1);
	assertEquals(rows[0].query, null);
});

Deno.test("rail depth has no entity, no weight, and a rounded depth", () => {
	const { rows } = toInterestRows(
		lookup,
		batch([{ name: "discovery.rail_depth", rail: "teams", depth: 0.4567, items: 12, at: 1 }]),
	);
	assertEquals(rows[0].entity_id, null);
	assertEquals(rows[0].entity_type, null);
	assertEquals(rows[0].weight, 0);
	assertEquals(rows[0].context, {
		surface: "explore.results",
		rail: "teams",
		depth: 0.46,
		items: 12,
	});
});

// #region Listing page views (SC5)
const owned: EntityLookup = (itemId) => {
	if (itemId === "logo-design") {
		return {
			entityId: "11111111-1111-1111-1111-111111111111",
			entityType: "service",
			ownerHandle: "@ada",
		};
	}
	if (itemId === "brand-brief") {
		return {
			entityId: "22222222-2222-2222-2222-222222222222",
			entityType: "project",
			ownerHandle: "@bea",
		};
	}
	return null;
};

const viewBatch = (itemId: string): DiscoveryEventBatch => ({
	sessionId: "session-0001",
	surface: "view.entity",
	events: [{ name: "discovery.view", itemId, itemType: "services", at: 1 }],
});

Deno.test("a listing's page view is one 'view' row with the page as its surface", () => {
	const { rows, dropped } = toInterestRows(owned, viewBatch("logo-design"));
	assertEquals(dropped, 0);
	assertEquals(rows, [{
		session_id: "session-0001",
		event_type: "view",
		entity_id: "11111111-1111-1111-1111-111111111111",
		entity_type: "service",
		query: null,
		weight: EVENT_WEIGHT.view,
		context: { surface: "view.entity" },
	}]);
});

Deno.test("the seller's own view of their listing is dropped, never stored", () => {
	const { rows, dropped } = toInterestRows(owned, viewBatch("logo-design"), new Set(["@ada"]));
	assertEquals(rows, []);
	assertEquals(dropped, 1);
});

Deno.test("a view is stored only for a service or a product listing", () => {
	const { rows, dropped } = toInterestRows(owned, viewBatch("brand-brief"));
	assertEquals(rows, []);
	assertEquals(dropped, 1);
});
// #endregion
