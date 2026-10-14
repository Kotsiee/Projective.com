import { assert, assertEquals } from "@std/assert";
import {
	formArchetypeOf,
	type ListingOffer,
	type UpdateListingInput,
} from "@projective/types/catalogue";
import { RESTRICTED_REFUSAL } from "@projective/types/auth";
import { assemble, primeCatalogForTesting } from "../explore/live-catalog.ts";
import { resolveListing } from "../explore/listing-source.ts";
import { CatalogueBackendService } from "./CatalogueBackendService.ts";
import { batchOutcomes, LISTING_CONFLICT_MESSAGE, refusalOf } from "./catalogue-refusals.ts";
import {
	FIXTURE_LISTINGS,
	FIXTURE_PROFILES,
	FIXTURE_REFS,
	FIXTURE_SKILLS,
} from "./catalogue-fixtures.ts";
import { stubCatalogueClient } from "./catalogue-stub-client.ts";
import { batchListings, savePatchBody, updateListing } from "./live-catalogue-writes.ts";
import { metricsOf, projectDetail } from "./live-catalogue.ts";

/**
 * The catalogue's write contract, without a database: what a stale save, a batch and an offer edit
 * send to the `catalogue.*` doors, and how their answers come back to the console.
 */

// #region Harness
const MARIS = FIXTURE_PROFILES[0].entity_id;
const SELLER = {
	userId: MARIS,
	contextId: MARIS,
	contextType: "personal" as const,
	accessToken: "token",
};
const STRANGER = {
	userId: "00000000-0000-4000-8000-0000000000ff",
	contextId: "00000000-0000-4000-8000-0000000000ff",
	contextType: "personal" as const,
	accessToken: "token",
};

const PIPELINE = FIXTURE_LISTINGS[0];

function detailOf(fixture: (typeof FIXTURE_LISTINGS)[number]) {
	return projectDetail({
		listing: fixture.listing,
		blueprint: fixture.blueprint,
		product: fixture.product,
		media: fixture.media,
		refs: FIXTURE_REFS,
		owner: { handle: "@maris", name: "Maris Okafor", avatar: "", kind: "freelancer" },
		metrics: metricsOf(fixture.listing, fixture.blueprint ?? fixture.product, [], (m) => m),
	});
}
// #endregion

// #region Update — the stale-save guard
Deno.test("update — a stale expectedUpdatedAt is a 409 carrying the listing's current stamp", async () => {
	const { client, calls } = stubCatalogueClient({
		tables: {
			service_blueprints: [PIPELINE.blueprint],
			listings: [PIPELINE.listing],
		},
		rpcErrors: {
			save_listing: {
				code: "PC409",
				message: "This listing was changed somewhere else since you opened it",
				details: "stale:2026-10-14T09:30:00.250Z",
			},
		},
	});
	const result = await updateListing(
		{ id: "svc-brandpipe01", expectedUpdatedAt: "2026-09-14T10:15:30.123Z", title: "Renamed" },
		SELLER,
		client,
	);
	assertEquals(result.status, 409);
	assertEquals(result.message, LISTING_CONFLICT_MESSAGE);
	assertEquals(result.details, { current: "2026-10-14T09:30:00.250Z" });
	const save = calls.find((c) => c.name === "save_listing");
	assertEquals(save?.args.p_listing, PIPELINE.listing.id);
	assertEquals(
		(save?.args.p_patch as Record<string, unknown>).expected_updated_at,
		"2026-09-14T10:15:30.123Z",
	);
});

Deno.test("update — somebody else's listing is a 404 and nothing is sent to the door", async () => {
	const { client, calls } = stubCatalogueClient({
		tables: { service_blueprints: [PIPELINE.blueprint], listings: [PIPELINE.listing] },
	});
	const result = await updateListing(
		{ id: "svc-brandpipe01", expectedUpdatedAt: "x", title: "Mine now" },
		STRANGER,
		client,
	);
	assertEquals(result.status, 404);
	assertEquals(calls, []);
});
// #endregion

// #region Refusals
Deno.test("refusals — each door code maps to its status and field", () => {
	assertEquals(
		refusalOf({ code: "PG422", message: "Not ready", details: "a cover image|a price" }).errors,
		{
			publish: "a cover image, a price",
		},
	);
	assertEquals(
		refusalOf({ code: "PG422", message: "At most 10 tags", details: "tags_max" }).errors,
		{
			tags: "At most 10 tags",
		},
	);
	const bad = refusalOf({
		code: "22023",
		message: "Stage 3 is malformed",
		details: "stage_template.2",
	});
	assertEquals([bad.status, bad.errors], [422, { "stageTemplate.2": "Stage 3 is malformed" }]);
	assertEquals(refusalOf({ code: "PM403", message: "minor" }).status, 403);
	assertEquals(refusalOf({ code: "PB404", message: "gone" }).status, 404);
	let threw = false;
	try {
		refusalOf({ code: "08006", message: "connection lost" });
	} catch {
		threw = true;
	}
	assert(threw, "an outage is thrown for the service guard to answer 503");
});
// #endregion

// #region Batch
Deno.test("batch — one outcome per listing, in the order sent, strangers' listings never sent", async () => {
	const [a, b] = [FIXTURE_LISTINGS[0], FIXTURE_LISTINGS[3]];
	const stranger = { ...FIXTURE_LISTINGS[4].listing, owner_user_id: STRANGER.userId };
	const { client, calls } = stubCatalogueClient({
		tables: {
			service_blueprints: [a.blueprint, b.blueprint, FIXTURE_LISTINGS[4].blueprint],
			products: [],
			listings: [a.listing, b.listing, stranger],
		},
		rpc: {
			set_listings_status: [
				{
					listing_id: b.listing.id,
					ok: false,
					code: "PG422",
					detail: "a cover image|a price",
					message: "Not ready",
				},
				{ listing_id: a.listing.id, ok: true, code: null, detail: null, message: null },
			],
		},
	});
	const result = await batchListings(
		{
			ids: ["svc-brandpipe01", "svc-reviewcall", "svc-figmacohort", "svc-missing"],
			action: "status",
			status: "published",
		},
		SELLER,
		client,
	);
	assertEquals(result.ok, true);
	assertEquals(result.data, [
		{ id: "svc-brandpipe01", ok: true },
		{
			id: "svc-reviewcall",
			ok: false,
			code: "PG422",
			message: "Can't publish yet: add a cover image, a price.",
		},
		{ id: "svc-figmacohort", ok: false, code: "PB404", message: "This listing no longer exists." },
		{ id: "svc-missing", ok: false, code: "PB404", message: "This listing no longer exists." },
	]);
	assertEquals(calls.find((c) => c.name === "set_listings_status")?.args, {
		p_listings: [a.listing.id, b.listing.id],
		p_status: "published",
	});
});

Deno.test("batch — an age-gated row says why, in the platform's own words", () => {
	const outcomes = batchOutcomes(
		[{ listing_id: "l1", ok: false, code: "PM403", detail: null, message: "raw" }],
		[{ slug: "svc-x", listingId: "l1" }],
	);
	assertEquals(outcomes, [{ id: "svc-x", ok: false, code: "PM403", message: RESTRICTED_REFUSAL }]);
});
// #endregion

// #region Offer round-trip
/** Apply a save_listing patch to the stored rows the way the door writes them. */
function stored<T extends object>(
	row: T | undefined,
	body: Record<string, unknown>,
): T | undefined {
	if (!row) return row;
	const written: Record<string, unknown> = {};
	for (const key of Object.keys(row)) if (key in body) written[key] = structuredClone(body[key]);
	return { ...row, ...written };
}

const EDITED: Record<string, (offer: ListingOffer) => ListingOffer> = {
	pipeline: (o) =>
		o.archetype === "pipeline"
			? {
				...o,
				stages: [...o.stages, {
					name: "Rollout",
					description: "",
					deliverables: ["Guidelines"],
					skills: [],
					startTrigger: "after_previous",
					lagDays: 0,
					chainReaction: true,
				}],
			}
			: o,
	one_off: (o) =>
		o.archetype === "one_off"
			? { ...o, turnaroundDays: 10, scope: [...o.scope, "Source files"] }
			: o,
	session: (o) =>
		o.archetype === "session" ? { ...o, minutes: 30, count: 3, meetingProvider: "google" } : o,
	cohort: (o) =>
		o.archetype === "cohort" ? { ...o, maxSeatsPerCohort: 20, continuousEnrollment: false } : o,
	product: (o) =>
		o.archetype === "product"
			? { ...o, licence: "extended", format: "bundle", attributionRequired: false }
			: o,
};

Deno.test("offer — detail → update patch → detail round-trips for every archetype", () => {
	const seen = new Set<string>();
	for (const fixture of FIXTURE_LISTINGS) {
		const before = detailOf(fixture);
		const archetype = formArchetypeOf(before.kind, before.serviceType);
		seen.add(archetype);
		const offer = EDITED[archetype](before.offer);
		const patch: UpdateListingInput = { id: before.id, expectedUpdatedAt: before.updatedAt, offer };
		const body = JSON.parse(
			JSON.stringify(
				savePatchBody(patch, { kind: before.kind, currency: before.currency, archetype }),
			),
		);
		const after = projectDetail({
			listing: fixture.listing,
			blueprint: stored(fixture.blueprint, body),
			product: stored(fixture.product, body),
			media: fixture.media,
			refs: FIXTURE_REFS,
			owner: before.owner,
			metrics: before.metrics,
		});
		assertEquals(after.offer, offer, before.id);
	}
	assertEquals([...seen].sort(), ["cohort", "one_off", "pipeline", "product", "session"]);
});

Deno.test("offer — Session ↔ Group Session travels as the delivery model; nothing else does", () => {
	const session = detailOf(FIXTURE_LISTINGS[3]);
	assert(session.offer.archetype === "session");
	const toCohort: ListingOffer = {
		...session.offer,
		archetype: "cohort",
		maxSeatsPerCohort: 8,
		continuousEnrollment: true,
	};
	const body = savePatchBody(
		{ id: session.id, expectedUpdatedAt: session.updatedAt, offer: toCohort },
		{ kind: "service", currency: "USD", archetype: "session" },
	);
	assertEquals(body.delivery_model, "group_session");
	const same = savePatchBody(
		{ id: session.id, expectedUpdatedAt: session.updatedAt, offer: session.offer },
		{ kind: "service", currency: "USD", archetype: "session" },
	);
	assertEquals("delivery_model" in same, false);
});

Deno.test("update patch — a currency change prices in the new currency's minor units", () => {
	const pricing = {
		amount: 5000,
		ticketPrice: null,
		sessionPrice: null,
		seatsPerSession: null,
		freeRevisions: null,
		extraRevisionPrice: 12.5,
	};
	const toJpy = savePatchBody(
		{
			id: "prd-dashkit001",
			expectedUpdatedAt: "2026-09-14T10:15:30.123Z",
			currency: "JPY",
			pricing,
		},
		{ kind: "product", currency: "USD", archetype: "product" },
	);
	assertEquals([toJpy.currency, toJpy.amount_cents, toJpy.extra_revision_price_cents], [
		"JPY",
		5000,
		13,
	]);
	const kept = savePatchBody(
		{ id: "prd-dashkit001", expectedUpdatedAt: "2026-09-14T10:15:30.123Z", pricing },
		{ kind: "product", currency: "USD", archetype: "product" },
	);
	assertEquals(["currency" in kept, kept.amount_cents], [false, 500_000]);
});

Deno.test("update patch — only sent keys travel; SEO and prices use the door's names and units", () => {
	const body = savePatchBody(
		{
			id: "prd-dashkit001",
			expectedUpdatedAt: "2026-09-14T10:15:30.123Z",
			seo: { seoTitle: "Dashboard kit", seoDescription: "" },
			pricing: {
				amount: 5000,
				ticketPrice: null,
				sessionPrice: null,
				seatsPerSession: null,
				freeRevisions: null,
				extraRevisionPrice: null,
			},
		},
		{ kind: "product", currency: "JPY", archetype: "product" },
	);
	assertEquals(body, {
		expected_updated_at: "2026-09-14T10:15:30.123Z",
		amount_cents: 5000,
		ticket_price_cents: null,
		session_price_cents: null,
		seats_per_session: null,
		free_revisions: null,
		extra_revision_price_cents: null,
		seo_title: "Dashboard kit",
		seo_description: "",
	});
});
// #endregion

// #region Preview — the owner's simulation
function primeFixtures(): void {
	primeCatalogForTesting(
		assemble({
			profiles: FIXTURE_PROFILES,
			listings: [],
			blueprints: [],
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
			skillRows: FIXTURE_SKILLS,
			placements: [],
		}),
		{ serve: true },
	);
}

function ownerClient(status: "draft" | "paused" | "archived") {
	return stubCatalogueClient({
		tables: {
			service_blueprints: [PIPELINE.blueprint],
			listings: [{ ...PIPELINE.listing, status }],
			skills: FIXTURE_SKILLS,
		},
		rpc: { get_public_media: [] },
	}).client;
}

Deno.test("preview — the owner resolves their own draft and paused listing", async () => {
	primeFixtures();
	try {
		for (const status of ["draft", "paused"] as const) {
			const resolved = await resolveListing("svc-brandpipe01", {
				as: "owner",
				actor: SELLER,
				client: ownerClient(status),
			});
			assertEquals(resolved?.item.id, "svc-brandpipe01", status);
		}
	} finally {
		primeCatalogForTesting(null);
	}
});

Deno.test("preview — a non-owner and an archived listing resolve exactly as a missing one", async () => {
	primeFixtures();
	try {
		assertEquals(
			await resolveListing("svc-brandpipe01", {
				as: "owner",
				actor: STRANGER,
				client: ownerClient("draft"),
			}),
			null,
		);
		assertEquals(
			await resolveListing("svc-brandpipe01", {
				as: "owner",
				actor: SELLER,
				client: ownerClient("archived"),
			}),
			null,
		);
		const empty = stubCatalogueClient({}).client;
		assertEquals(
			await resolveListing("svc-nothing", { as: "owner", actor: SELLER, client: empty }),
			null,
		);
	} finally {
		primeCatalogForTesting(null);
	}
});

Deno.test("preview — a guest is refused before anything is read", async () => {
	const result = await CatalogueBackendService.previewView("svc-brandpipe01", {
		userId: "",
		contextId: "",
		contextType: "personal",
	});
	assertEquals(result.status, 401);
});
// #endregion
