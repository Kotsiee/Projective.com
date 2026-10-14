import { assert, assertEquals } from "@std/assert";
import {
	EMBEDDING_DIMENSIONS,
	type ExploreParams,
	type ServiceItem,
} from "@projective/types/explore";
import {
	blendSemantic,
	nearestKindsFor,
	SEMANTIC_EXTRA_LIMIT,
	semanticResults,
	similarityFrom,
} from "./semantic.ts";
import { getResults } from "./query.ts";
import { assemble, type CatalogInputs, primeCatalogForTesting } from "./live-catalog.ts";
import { ExploreBackendService } from "./ExploreBackendService.ts";
import { setEmbeddingDepsForTesting } from "../search/EmbeddingBackendService.ts";

// #region Fixtures
const OWNER_A = { handle: "@ana", name: "Ana", avatar: "", kind: "freelancer" as const };
const OWNER_B = { handle: "@ben", name: "Ben", avatar: "", kind: "freelancer" as const };

function service(
	id: string,
	title: string,
	category: string,
	price: number,
	owner = OWNER_A,
): ServiceItem {
	return {
		id,
		type: "services",
		title,
		owner,
		skills: [],
		summary: `${title}.`,
		createdAt: "2026-09-01T00:00:00.000Z",
		price: `$${price}`,
		priceMinor: price * 100,
		currency: "USD",
		delivery: "7-day delivery",
		category,
		serviceType: "One-Off",
	};
}

const LOGO = service("svc-logo", "Logo design", "branding", 400);
const LOGO_PACK = service("svc-logo-pack", "Logo pack refresh", "branding", 900, OWNER_B);
const LANDING = service("svc-landing", "Landing page in a week", "web", 1200);
const BRAND = service("svc-brand", "Brand identity sprint", "branding", 1500, OWNER_B);
const PACKAGING = service("svc-pack", "Packaging art direction", "branding", 1900);
const CORPUS = [LOGO, LOGO_PACK, LANDING, BRAND, PACKAGING];

function params(q: string, overrides: Partial<ExploreParams> = {}): ExploreParams {
	return { q, category: "services", sort: "recommended", filters: {}, ...overrides };
}

const ids = (items: ReadonlyArray<{ id: string }>) => items.map((it) => it.id);
// #endregion

Deno.test("nearestKindsFor — the category's scope in the database's vocabulary", () => {
	assertEquals(nearestKindsFor("all"), null);
	assertEquals(nearestKindsFor("services"), ["service_blueprint"]);
	assertEquals(nearestKindsFor("freelancers"), ["freelancer", "team"]);
	assertEquals(nearestKindsFor("users"), ["user", "business"]);
});

Deno.test("similarityFrom — resolves rows to items, drops strangers, keeps the first score", () => {
	const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
	const items = new Map([[uuid(1), "svc-logo"], [uuid(2), "svc-brand"]]);
	const sim = similarityFrom(
		[
			{ entity_type: "service_blueprint", entity_id: uuid(2), score: 0.42 },
			{ entity_type: "service_blueprint", entity_id: uuid(9), score: 0.9 },
			{ entity_type: "service_blueprint", entity_id: uuid(1), score: "0.38" },
			{ entity_type: "service_blueprint", entity_id: uuid(2), score: 0.1 },
		],
		(_kind, id) => items.get(id),
	);
	assertEquals([...sim], [["svc-brand", 0.42], ["svc-logo", 0.38]]);
});

Deno.test("stable when off — no similarity data changes nothing, and a zero weight is today's order", () => {
	for (const q of ["logo", "", "brnd identity"]) {
		const p = params(q);
		assertEquals(ids(semanticResults(CORPUS, p, undefined, new Map())), ids(getResults(CORPUS, p)));
	}
	const candidates = getResults(CORPUS, params("logo"));
	const similarity = new Map([["svc-logo-pack", 0.41], ["svc-logo", 0.2], ["svc-brand", 0.4]]);
	assertEquals(
		ids(blendSemantic(candidates, [BRAND], similarity, 0)),
		[...ids(candidates), "svc-brand"],
		"weight 0 keeps the candidates' order and only appends",
	);
});

Deno.test("re-rank — similarity lifts a closer candidate on the default sort", () => {
	const p = params("logo");
	assertEquals(ids(getResults(CORPUS, p)), ["svc-logo", "svc-logo-pack"]);
	const closer = new Map([["svc-logo-pack", 0.42], ["svc-logo", 0.1]]);
	assertEquals(ids(semanticResults(CORPUS, p, undefined, closer)), ["svc-logo-pack", "svc-logo"]);
	const level = new Map([["svc-logo-pack", 0.42], ["svc-logo", 0.4]]);
	assertEquals(
		ids(semanticResults(CORPUS, p, undefined, level)),
		["svc-logo", "svc-logo-pack"],
		"a near tie in similarity leaves the existing order alone",
	);
});

Deno.test("extras — a typo finds its neighbours, under both similarity floors", () => {
	const p = params("brnd identity");
	assertEquals(getResults(CORPUS, p), [], "the text match finds nothing");
	const similarity = new Map([
		["svc-brand", 0.42],
		["svc-logo-pack", 0.36],
		["svc-pack", 0.31],
		["svc-landing", 0.2],
	]);
	assertEquals(
		ids(semanticResults(CORPUS, p, undefined, similarity)),
		["svc-brand", "svc-logo-pack"],
		"0.31 is under 0.8 × the best (0.336); 0.2 is under the 0.3 floor",
	);
	assertEquals(
		semanticResults(CORPUS, p, undefined, new Map([["svc-landing", 0.29]])),
		[],
		"nothing clears the absolute floor, so a nonsense query adds nothing",
	);
});

Deno.test("extras — pass the same facets and scope, and are capped", () => {
	const similarity = new Map([["svc-brand", 0.42], ["svc-landing", 0.4]]);
	const web = params("brnd identity", { filters: { cat: ["web"] } });
	assertEquals(ids(semanticResults(CORPUS, web, undefined, similarity)), ["svc-landing"]);
	const many = Array.from(
		{ length: 20 },
		(_, i) => service(`svc-${i}`, `Thing ${i}`, "branding", 100 + i),
	);
	const crowd = new Map(many.map((it) => [it.id, 0.4] as [string, number]));
	assertEquals(semanticResults(many, params("zz"), undefined, crowd).length, SEMANTIC_EXTRA_LIMIT);
});

Deno.test("extras — an explicit sort the reader chose still decides the order", () => {
	const p = params("logo", { sort: "price_asc" });
	const similarity = new Map([["svc-pack", 0.5], ["svc-brand", 0.45], ["svc-logo", 0.1]]);
	assertEquals(
		ids(semanticResults(CORPUS, p, undefined, similarity)),
		["svc-logo", "svc-logo-pack", "svc-brand", "svc-pack"],
		"by price, not by similarity",
	);
});

// #region Service level — no database, no network
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";

function profile(id: string, handle: string, name: string): CatalogInputs["profiles"][number] {
	return {
		entity_id: id,
		entity_type: "freelancer",
		handle,
		name,
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
	};
}

function primeServices(): void {
	const rows = CORPUS.map((it, i) => ({ it, n: i + 1 }));
	const owner = (it: ServiceItem) => (it.owner.handle === "@ana" ? A : B);
	const inputs: CatalogInputs = {
		profiles: [profile(A, "ana", "Ana"), profile(B, "ben", "Ben")],
		listings: rows.map(({ it, n }) => ({
			id: `00000000-0000-4000-8000-00000000c00${n}`,
			owner_user_id: owner(it),
			owner_team_id: null,
			kind: "service" as const,
			service_blueprint_id: `00000000-0000-4000-8000-00000000b00${n}`,
			product_id: null,
			title: it.title,
			description_text: it.summary,
			category: it.category,
			delivery_label: it.delivery,
			amount_cents: it.priceMinor ?? 0,
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
			created_at: "2026-09-01T00:00:00Z",
			updated_at: "2026-09-01T00:00:00Z",
		})),
		blueprints: rows.map(({ it, n }) => ({
			id: `00000000-0000-4000-8000-00000000b00${n}`,
			slug: it.id,
			owner_type: "freelancer",
			owner_team_id: null,
			freelancer_profile_id: owner(it),
			delivery_model: "one_off" as const,
			price_cents: it.priceMinor ?? 0,
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
		placements: [],
	};
	primeCatalogForTesting(assemble(inputs), { serve: true });
}

async function withQuietWarnings<T>(run: (warnings: string[]) => Promise<T>): Promise<T> {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
	try {
		return await run(warnings);
	} finally {
		console.warn = original;
	}
}

Deno.test("search — with the gate off nothing calls Voyage and the payload is today's", async () => {
	primeServices();
	let calls = 0;
	setEmbeddingDepsForTesting({
		fetch: () => {
			calls++;
			return Promise.reject(new Error("must not be called"));
		},
		apiKey: () => "pa-test",
	});
	try {
		const p = params("logo");
		const off = await ExploreBackendService.search({ params: p });
		const offExplicit = await ExploreBackendService.search({ params: p, semantic: false });
		assert(off.ok && off.data && offExplicit.ok && offExplicit.data);
		assertEquals(off.ranking, "heuristic");
		assertEquals(offExplicit.data, off.data);
		assertEquals(ids(off.data.items), ["svc-logo", "svc-logo-pack"]);
		assertEquals(calls, 0);
		const blank = await ExploreBackendService.search({ params: params(""), semantic: true });
		assertEquals(blank.ranking, "heuristic", "a category browse has no query to embed");
		assertEquals(calls, 0);
	} finally {
		setEmbeddingDepsForTesting(null);
		primeCatalogForTesting(null);
	}
});

Deno.test("search — a Voyage outage falls back to today's results, logged once, never an error", async () => {
	primeServices();
	let calls = 0;
	setEmbeddingDepsForTesting({
		fetch: () => {
			calls++;
			return Promise.resolve(new Response("unavailable", { status: 503 }));
		},
		sleep: () => Promise.resolve(),
		apiKey: () => "pa-test",
	});
	try {
		await withQuietWarnings(async (warnings) => {
			const p = params("logo");
			const heuristic = await ExploreBackendService.search({ params: p });
			const fallback = await ExploreBackendService.search({ params: p, semantic: true });
			assert(fallback.ok && fallback.data && heuristic.ok);
			assertEquals(fallback.ranking, "heuristic");
			assertEquals(fallback.data, heuristic.data);
			assertEquals(calls, 3, "one call and two retries");
			assertEquals(warnings.length, 1);
			assert(warnings[0].startsWith("[embeddings] search fell back"));
		});
	} finally {
		setEmbeddingDepsForTesting(null);
		primeCatalogForTesting(null);
	}
});

Deno.test("search — a database failure after a good query vector falls back too", async () => {
	primeServices();
	const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
	setEmbeddingDepsForTesting({
		fetch: () =>
			Promise.resolve(
				Response.json({ data: [{ embedding: vector, index: 0 }], usage: { total_tokens: 1 } }),
			),
		apiKey: () => "pa-test",
	});
	const saved = Deno.env.get("SUPABASE_URL");
	Deno.env.delete("SUPABASE_URL");
	try {
		await withQuietWarnings(async (warnings) => {
			const res = await ExploreBackendService.search({ params: params("logo"), semantic: true });
			assert(res.ok && res.data);
			assertEquals(res.ranking, "heuristic");
			assertEquals(ids(res.data.items), ["svc-logo", "svc-logo-pack"]);
			assertEquals(warnings.length, 1);
		});
	} finally {
		if (saved !== undefined) Deno.env.set("SUPABASE_URL", saved);
		setEmbeddingDepsForTesting(null);
		primeCatalogForTesting(null);
	}
});
// #endregion
