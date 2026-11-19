import { assert, assertEquals } from "@std/assert";
import { FIXTURE_LISTINGS, FIXTURE_PROFILES, FIXTURE_SKILLS } from "../catalogue/catalogue-fixtures.ts";
import { stubCatalogueClient } from "../catalogue/catalogue-stub-client.ts";
import { resolveListing } from "./listing-source.ts";
import { assemble, primeCatalogForTesting } from "./live-catalog.ts";

/**
 * Discovery's `catalogue.listings` reads parse each row by its row schema before anything maps it
 * (#501 flag (a)). A row the schema refuses is dropped and named in a warning, never served: one
 * seller's malformed row must not take the storefront down with it.
 */

// #region Harness
const PIPELINE = FIXTURE_LISTINGS[0];
const SELLER = {
	userId: FIXTURE_PROFILES[0].entity_id,
	contextId: FIXTURE_PROFILES[0].entity_id,
	contextType: "personal" as const,
	accessToken: "token",
};

function primeProfiles(): void {
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

function previewOf(listing: unknown) {
	return resolveListing("svc-brandpipe01", {
		as: "owner",
		actor: SELLER,
		client: stubCatalogueClient({
			tables: {
				service_blueprints: [PIPELINE.blueprint],
				listings: [listing],
				skills: FIXTURE_SKILLS,
			},
			rpc: { get_public_media: [] },
		}).client,
	});
}

/** `fn`'s result and every `console.warn` line it printed. */
async function withWarnings<T>(fn: () => Promise<T>): Promise<{ value: T; warnings: string[] }> {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
	try {
		return { value: await fn(), warnings };
	} finally {
		console.warn = original;
	}
}
// #endregion

// #region The view page's read
Deno.test("a listing row the table would refuse resolves as missing, and is named", async () => {
	primeProfiles();
	try {
		const bad = { ...PIPELINE.listing, status: "draft", currency: "usd" };
		const { value, warnings } = await withWarnings(() => previewOf(bad));
		assertEquals(value, null);
		assert(
			warnings.some((w) => w.includes(PIPELINE.listing.id) && w.includes("currency")),
			warnings.join("\n"),
		);
	} finally {
		primeCatalogForTesting(null);
	}
});

Deno.test("a well-formed listing row still resolves", async () => {
	primeProfiles();
	try {
		const resolved = await previewOf({ ...PIPELINE.listing, status: "draft" });
		assertEquals(resolved?.item.id, "svc-brandpipe01");
	} finally {
		primeCatalogForTesting(null);
	}
});
// #endregion
