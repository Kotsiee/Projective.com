import { assert, assertEquals } from "@std/assert";
import {
	CatalogueAnalyticsSchema,
	ClientDetailSchema,
	ClientPipelineSchema,
} from "@projective/types/catalogue";
import type { ReadActor } from "../read-actor.ts";
import { CatalogueAnalyticsBackendService } from "./CatalogueAnalyticsBackendService.ts";
import { CatalogueClientsBackendService } from "./CatalogueClientsBackendService.ts";
import { fixtureScopedListings } from "./analytics-fixtures.ts";

/**
 * catalogue-reads_test — the Analytics and Clients services on their fixture path
 * (`CATALOGUE_BACKEND_LIVE` off, forced here with `USE_MOCKS`): every dev-axis state parses against
 * its contract, a guest is refused, and a listing or buyer outside the caller's scope is a 404.
 */

// #region Harness
const SELLER: ReadActor = { userId: "u-maris", contextId: "", contextType: "personal" };
const GUEST: ReadActor = { userId: "", contextId: "", contextType: "personal" };
const NOW = new Date("2026-10-14T12:00:00Z");

async function withFixtures(run: () => Promise<void>): Promise<void> {
	const before = Deno.env.get("USE_MOCKS");
	Deno.env.set("USE_MOCKS", "true");
	try {
		await run();
	} finally {
		if (before === undefined) Deno.env.delete("USE_MOCKS");
		else Deno.env.set("USE_MOCKS", before);
	}
}

const SESSION_SLUG = fixtureScopedListings().find((l) => l.model === "session")?.slug ?? "";
// #endregion

// #region Analytics
Deno.test("analytics fixtures: every state parses, and empty / sparse / rich differ honestly", () =>
	withFixtures(async () => {
		const read = async (sim: string) => {
			const r = await CatalogueAnalyticsBackendService.overview(
				{ kind: "catalogue", filter: "all" },
				"30d",
				SELLER,
				"USD",
				{ sim, now: NOW },
			);
			assertEquals(r.status, 200, sim);
			return CatalogueAnalyticsSchema.parse(r.data);
		};
		const [empty, sparse, rich, auto] = await Promise.all(
			["empty", "sparse", "rich", "auto"].map(read),
		);
		assertEquals(empty.tiles.find((t) => t.key === "gross")?.value, 0);
		assertEquals(empty.topListings, []);
		assertEquals(sparse.tiles.find((t) => t.key === "conversion")?.sufficient, false);
		assertEquals(sparse.keywords, []);
		assertEquals(rich.tiles.find((t) => t.key === "conversion")?.sufficient, true);
		assert(rich.keywords.length > 0);
		assert(rich.heatmap.some((c) => c.value > 0));
		assertEquals(auto, rich);
		assertEquals(rich.asOf, "2026-10-13");
	}));

Deno.test("analytics: a guest is a 401; an unknown listing is a 404", () =>
	withFixtures(async () => {
		const scope = { kind: "catalogue", filter: "all" } as const;
		assertEquals(
			(await CatalogueAnalyticsBackendService.overview(scope, "7d", GUEST, "USD")).status,
			401,
		);
		const missing = await CatalogueAnalyticsBackendService.overview(
			{ kind: "listing", listingId: "svc-notmine01" },
			"7d",
			SELLER,
			"USD",
		);
		assertEquals([missing.status, missing.message], [404, "No such listing."]);
	}));

Deno.test("analytics: a listing scope covers that listing alone, with no top-listings table", () =>
	withFixtures(async () => {
		const r = await CatalogueAnalyticsBackendService.overview(
			{ kind: "listing", listingId: SESSION_SLUG },
			"90d",
			SELLER,
			"USD",
			{ now: NOW },
		);
		const data = CatalogueAnalyticsSchema.parse(r.data);
		assertEquals([data.topListings, data.bucket], [[], "week"]);
		assert(data.heatmap.length === 168);
	}));
// #endregion

// #region Clients
Deno.test("clients fixtures: every state parses; action-required leads by severity", () =>
	withFixtures(async () => {
		for (const sim of ["empty", "action_required", "busy", "auto"]) {
			const r = await CatalogueClientsBackendService.pipeline({ filter: "all" }, SELLER, "USD", {
				sim,
				now: NOW.getTime(),
			});
			const board = ClientPipelineSchema.parse(r.data);
			if (sim === "empty") assertEquals(board.clients, []);
			else {
				assertEquals(board.clients[0].engagements[0].actionReasons[0], "dispute_open", sim);
			}
		}
	}));

Deno.test("client(): a buyer in scope is answered; one with nothing in scope is a 404", () =>
	withFixtures(async () => {
		const now = NOW.getTime();
		const found = await CatalogueClientsBackendService.client(
			"@noor_haddad",
			{
				filter: "all",
			},
			SELLER,
			"USD",
			{ now },
		);
		const detail = ClientDetailSchema.parse(found.data);
		assertEquals(detail.reschedules.length, 1);

		const outOfScope = await CatalogueClientsBackendService.client(
			"@noor_haddad",
			{
				filter: "product",
			},
			SELLER,
			"USD",
			{ now },
		);
		assertEquals([outOfScope.status, outOfScope.message], [404, "No such client."]);

		const stranger = await CatalogueClientsBackendService.client(
			"@nobody_here",
			{
				filter: "all",
			},
			SELLER,
			"USD",
			{ now },
		);
		assertEquals(stranger.status, 404);
		assertEquals(
			(await CatalogueClientsBackendService.client("@ada_lin", {}, GUEST, "USD")).status,
			401,
		);
	}));

Deno.test("clients: an unknown listing scope is a 404, not an empty board", () =>
	withFixtures(async () => {
		const r = await CatalogueClientsBackendService.pipeline(
			{ listing: "svc-notmine01" },
			SELLER,
			"USD",
		);
		assertEquals(r.status, 404);
	}));
// #endregion
