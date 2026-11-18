import { assert, assertEquals } from "@std/assert";
import type { ExploreItem, ExploreParams, ServiceItem } from "@projective/types/explore";
import { assemble, type CatalogInputs, primeCatalogForTesting } from "./live-catalog.ts";
import { ExploreBackendService } from "./ExploreBackendService.ts";
import {
	homePromotedSlots,
	type PlacementSource,
	resultPromotedSlots,
	SLOT_ROTATION_MS,
} from "./promoted-slots.ts";

// #region Pure fixtures
const OWNER = { handle: "@ana", name: "Ana", avatar: "", kind: "freelancer" as const };

function svc(id: string): ServiceItem {
	return {
		id,
		type: "services",
		title: id,
		owner: OWNER,
		skills: [],
		summary: `${id}.`,
		createdAt: "2026-09-01T00:00:00.000Z",
		price: "$100",
		priceMinor: 10_000,
		currency: "USD",
		delivery: "7-day delivery",
		category: "branding",
		serviceType: "One-Off",
	};
}

function source(
	items: ExploreItem[],
	placements: PlacementSource["placements"],
): PlacementSource {
	return { placements, byId: new Map(items.map((it) => [it.id, it])) };
}

const A = svc("svc-a");
const B = svc("svc-b");
const C = svc("svc-c");
// #endregion

Deno.test("home — one slot per rail, rotating among the live flights by the hour", () => {
	const src = source([A, B, C], [
		{ surface: "explore_home", itemId: "svc-a" },
		{ surface: "explore_home", itemId: "svc-b" },
		{ surface: "explore_results", itemId: "svc-c" },
	]);
	const first = homePromotedSlots(src, 0);
	assertEquals(first.map((s) => s.itemId), ["svc-a"]);
	assertEquals(homePromotedSlots(src, SLOT_ROTATION_MS).map((s) => s.itemId), ["svc-b"]);
	assertEquals(homePromotedSlots(src, 2 * SLOT_ROTATION_MS).map((s) => s.itemId), ["svc-a"]);
	assertEquals(first[0].rail, "services");
	assertEquals(first[0].href, "/view/svc-a");
});

Deno.test("results — a slot is drawn only from what already matches, on the first page", () => {
	const src = source([A, B, C], [
		{ surface: "explore_results", itemId: "svc-c" },
		{ surface: "explore_home", itemId: "svc-a" },
	]);
	assertEquals(
		resultPromotedSlots(src, [A, B], "services", 0, 0),
		[],
		"an unmatched listing is never placed",
	);
	assertEquals(resultPromotedSlots(src, [A, C], "services", 0, 0).map((s) => s.itemId), ["svc-c"]);
	assertEquals(resultPromotedSlots(src, [A, C], "all", 0, 0).map((s) => s.itemId), ["svc-c"]);
	assertEquals(
		resultPromotedSlots(src, [A, C], "services", 18, 0),
		[],
		"never repeated on a later page",
	);
	assertEquals(
		resultPromotedSlots(src, [A, C], "freelancers", 0, 0),
		[],
		"no slot outside a listing rail",
	);
});

// #region The acceptance rule: organic order is identical with and without placements
const OWNER_ID = "00000000-0000-4000-8000-0000000000a1";
const SERVICES = [
	{ n: 1, title: "Logo design", price: 40_000 },
	{ n: 2, title: "Logo pack refresh", price: 90_000 },
	{ n: 3, title: "Brand identity sprint", price: 150_000 },
	{ n: 4, title: "Landing page in a week", price: 120_000 },
];
const blueprintId = (n: number) => `00000000-0000-4000-8000-00000000b00${n}`;

function inputs(placements: CatalogInputs["placements"]): CatalogInputs {
	return {
		profiles: [{
			entity_id: OWNER_ID,
			entity_type: "freelancer",
			handle: "ana",
			name: "Ana",
			headline: "Designer",
			languages: null,
			location: null,
			city: null,
			rating_as_client: null,
			reviews_as_client: 0,
			rating_as_freelancer: null,
			reviews_as_freelancer: 0,
			active_project_count: 0,
			total_project_count: 0,
			member_count: null,
			listed: true,
			avatar_bucket: null,
			avatar_path: null,
			banner_bucket: null,
			banner_path: null,
			verified: false,
			skills: [],
			workload: 0,
			joined_at: "2026-01-01T00:00:00Z",
			verification_tier: null,
			language_codes: [],
			delivered_count: 0,
			showcase_bucket: null,
			showcase_path: null,
			standing_level: 1,
			standing_label: "New",
			discovery_weight_bp: 10_000,
			workload_cap: 10,
			verification_stamp: "none",
		}],
		listings: SERVICES.map(({ n, title, price }) => ({
			id: `00000000-0000-4000-8000-00000000c00${n}`,
			owner_user_id: OWNER_ID,
			owner_team_id: null,
			kind: "service" as const,
			service_blueprint_id: blueprintId(n),
			product_id: null,
			title,
			description_text: `${title}.`,
			category: "branding",
			delivery_label: "7-day delivery",
			amount_cents: price,
			currency: "USD",
			ticket_price_cents: null,
			session_price_cents: null,
			seats_per_session: null,
			free_revisions: null,
			extra_revision_price_cents: null,
			promoted: false,
			seo_description: null,
			status: "published" as const,
			published_at: "2026-09-01T00:00:00Z",
			created_at: `2026-09-0${n}T00:00:00Z`,
			updated_at: "2026-09-01T00:00:00Z",
		})),
		blueprints: SERVICES.map(({ n, title, price }) => ({
			id: blueprintId(n),
			slug: `svc-${title.toLowerCase().replaceAll(" ", "-")}`,
			owner_type: "freelancer",
			owner_team_id: null,
			freelancer_profile_id: OWNER_ID,
			delivery_model: "one_off" as const,
			price_cents: price,
			ticket_price_cents: null,
			session_price_cents: null,
			currency: "USD",
			free_revisions: null,
			extra_revision_price_cents: null,
			max_seats_per_cohort: 1,
			intake_fields: [],
			stage_template: [],
			team_roles: [],
			deliverables: [],
			session_minutes: null,
			session_count: null,
			session_plan: [],
			session_rolling: false,
			rating_average: 0,
			rating_count: 0,
		})),
		products: [],
		articles: [],
		projects: [],
		stages: [],
		roles: [],
		seats: [],
		media: [],
		files: [],
		listingSkills: [],
		requiredSkills: [],
		skillRows: [],
		placements,
	};
}

const PLACED: CatalogInputs["placements"] = [
	{ entity_type: "service", entity_id: blueprintId(3), surface: "explore_results" },
	{ entity_type: "service", entity_id: blueprintId(4), surface: "explore_home" },
];

function query(category: ExploreParams["category"], q = ""): ExploreParams {
	return { q, category, sort: "recommended", filters: {} };
}

async function searchWith(placements: CatalogInputs["placements"], params: ExploreParams) {
	primeCatalogForTesting(assemble(inputs(placements)), { serve: true });
	const res = await ExploreBackendService.search({ params, showPromoted: true });
	assert(res.ok && res.data, res.message);
	return res.data;
}

Deno.test("organic order — identical with and without placements, the slot beside it", async () => {
	for (const params of [query("services", "logo"), query("services"), query("all", "brand")]) {
		const bare = await searchWith([], params);
		const placed = await searchWith(PLACED, params);
		assertEquals(placed.items.map((it) => it.id), bare.items.map((it) => it.id), params.q);
		assertEquals(placed.groups, bare.groups, params.q);
		assertEquals(placed.count, bare.count, "a promotion never adds to the result count");
		assertEquals(bare.promoted, []);
	}
	const placed = await searchWith(PLACED, query("services"));
	assertEquals(placed.promoted.map((s) => s.itemId), ["svc-brand-identity-sprint"]);
	assert(
		placed.items.some((it) => it.id === "svc-brand-identity-sprint"),
		"the promoted listing keeps its own organic position",
	);
});

Deno.test("organic order — a caller that does not clear the viewer gets no slot", async () => {
	primeCatalogForTesting(assemble(inputs(PLACED)), { serve: true });
	const res = await ExploreBackendService.search({ params: query("services") });
	assertEquals(res.data?.promoted, []);
	const minor = await ExploreBackendService.search({
		params: query("services"),
		showPromoted: false,
	});
	assertEquals(minor.data?.promoted, []);
});
// #endregion
