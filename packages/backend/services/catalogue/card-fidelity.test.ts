import { assert, assertEquals } from "@std/assert";
import { listingCardItem } from "@projective/types/explore";
import { resolveSkill } from "../explore/skills.ts";
import { assemble, stampOf } from "../explore/live-catalog.ts";
import { metricsOf, projectDetail } from "./live-catalogue.ts";
import {
	FIXTURE_LISTINGS,
	FIXTURE_PROFILES,
	FIXTURE_REFS,
	FIXTURE_SKILLS,
	fixtureTags,
} from "./catalogue-fixtures.ts";

/**
 * The card-fidelity contract (plan §4.6): the card discovery assembles from a listing's rows is the
 * SAME item the seller's workspace draws from that listing's detail. Both go through
 * `listingCardItem`; this holds the two row mappings that feed it to one answer, for every fixture
 * listing.
 */

// #region Harness
const STORAGE = "https://storage.example.test";

function withStorage(run: () => void): () => void {
	return () => {
		const previous = Deno.env.get("SUPABASE_PUBLIC_URL");
		Deno.env.set("SUPABASE_PUBLIC_URL", STORAGE);
		try {
			run();
		} finally {
			if (previous === undefined) Deno.env.delete("SUPABASE_PUBLIC_URL");
			else Deno.env.set("SUPABASE_PUBLIC_URL", previous);
		}
	};
}

function discovery() {
	return assemble({
		profiles: FIXTURE_PROFILES,
		listings: FIXTURE_LISTINGS.map((f) => f.listing),
		blueprints: FIXTURE_LISTINGS.flatMap((f) => f.blueprint ? [f.blueprint] : []),
		products: FIXTURE_LISTINGS.flatMap((f) => f.product ? [f.product] : []),
		articles: [],
		projects: [],
		stages: [],
		roles: [],
		seats: [],
		media: FIXTURE_LISTINGS.flatMap((f) => f.media),
		mediaRefs: FIXTURE_REFS,
		files: [],
		listingSkills: FIXTURE_LISTINGS.flatMap((f) =>
			f.skillIds.map((skill_id) => ({ listing_id: f.listing.id, skill_id }))
		),
		listingTags: fixtureTags(),
		requiredSkills: [],
		skillRows: FIXTURE_SKILLS,
		// A promoted listing is sponsored only with a live placement; every promoted fixture has one.
		placements: FIXTURE_LISTINGS.filter((f) => f.listing.promoted).map((f) => ({
			entity_type: f.blueprint ? "service_blueprint" : "product",
			entity_id: (f.blueprint ?? f.product)?.id ?? "",
			surface: "explore_results" as const,
		})),
	});
}

function workspaceDetail(fixture: (typeof FIXTURE_LISTINGS)[number]) {
	const owner = FIXTURE_PROFILES.find((p) =>
		p.entity_id === (fixture.listing.owner_team_id ?? fixture.listing.owner_user_id)
	);
	assert(owner, `fixture owner for ${fixture.listing.title}`);
	const label = new Map(FIXTURE_SKILLS.map((s) => [s.id, s.label]));
	return projectDetail({
		listing: fixture.listing,
		blueprint: fixture.blueprint,
		product: fixture.product,
		media: fixture.media,
		refs: FIXTURE_REFS,
		owner: {
			handle: `@${owner.handle}`,
			name: owner.name,
			avatar: "",
			kind: owner.entity_type,
			verified: owner.verified,
			verificationStamp: stampOf(owner.verification_stamp),
		},
		metrics: metricsOf(fixture.listing, fixture.blueprint ?? fixture.product, [], (minor) => minor),
		skills: fixture.skillIds.map((id) => resolveSkill(label.get(id) ?? "")),
		tags: fixture.tags,
	});
}
// #endregion

// #region Contract
Deno.test(
	"card fidelity — every fixture listing's discovery card IS its workspace card",
	withStorage(() => {
		const catalog = discovery();
		for (const fixture of FIXTURE_LISTINGS) {
			const detail = workspaceDetail(fixture);
			const item = catalog.byId.get(detail.id);
			assert(item, `${detail.id} is in the assembled catalogue`);
			assertEquals(item, listingCardItem(detail), detail.id);
		}
	}),
);

Deno.test(
	"card fidelity — the fixtures exercise what has drifted before",
	withStorage(() => {
		const catalog = discovery();
		const card = (id: string) => catalog.byId.get(id);

		const pipeline = card("svc-brandpipe01");
		assert(pipeline?.type === "services");
		assertEquals(
			pipeline.media,
			`${STORAGE}/storage/v1/object/public/showcase/00000000-0000-4000-8000-0000000000a1/showcase/f0a1/md.webp`,
		);
		assertEquals(pipeline.sponsored, true);
		assertEquals(pipeline.ticketPrice, 600);

		const product = card("prd-dashkit001");
		assert(product?.type === "products");
		assertEquals([product.currency, product.priceMinor, product.price], ["JPY", 5000, "¥5,000"]);
		assertEquals(product.mediaMeta, { width: 3000, height: 2400, aspectRatio: 1.25 });
		assertEquals(product.span, 2);

		const cohort = card("svc-figmacohort");
		assertEquals(cohort?.rating, { asHelper: { value: 4.8, count: 6 } });
		assertEquals(cohort?.media, undefined);

		const draft = card("prd-brushpack1");
		assert(draft?.type === "products");
		assertEquals([draft.price, draft.priceMinor], ["Set a price", undefined]);

		assertEquals(card("svc-logosprint1")?.createdAt, "2026-08-30T12:00:00Z");
	}),
);

Deno.test(
	"card fidelity — the view gallery keeps a video slot a video",
	withStorage(() => {
		const gallery = discovery().galleryById.get("svc-brandpipe01") ?? [];
		assertEquals(gallery.map((m) => [m.kind, m.alt]), [["image", "Brand board"], [
			"video",
			"Process reel",
		]]);
		assertEquals(gallery[1].src.endsWith("/video.mp4"), true);
	}),
);

Deno.test(
	"card fidelity — a listing's tags and search description reach its embedding terms",
	withStorage(() => {
		assertEquals(discovery().listingTermsById.get("svc-brandpipe01"), {
			tags: ["branding", "identity"],
			seoDescription: "A brand system delivered ticket by ticket.",
		});
	}),
);
// #endregion
