/**
 * sitemap-fixtures — a discovery catalogue holding every kind of row the sitemap must refuse beside
 * the rows it must list (Decision #452), assembled through the real {@link assemble}. Shared by the
 * selection test (`sitemap-sources.test.ts`) and the sitemap's end-to-end test in `apps/web`.
 *
 * @module
 */
import {
	assemble,
	type BlueprintRow,
	type Catalog,
	type CatalogInputs,
	type ListingRow,
	type ProductRow,
	type ProfileRow,
} from "./live-catalog.ts";

// #region Ids
const ANA = "00000000-0000-4000-8000-0000000005a1";
const ULA = "00000000-0000-4000-8000-0000000005a2";
const MIA = "00000000-0000-4000-8000-0000000005a3";
const GHOST = "00000000-0000-4000-8000-0000000005a4";
const STUDIO = "00000000-0000-4000-8000-0000000005b1";
const HUSH = "00000000-0000-4000-8000-0000000005b2";
const ACME = "00000000-0000-4000-8000-0000000005c1";
// #endregion

// #region Expectations
/** The slugs the sitemap lists: published, owned by a public profile. */
export const SITEMAP_FIXTURE_LISTED_SLUGS: readonly string[] = [
	"art-ana0public",
	"prd-ana0public",
	"svc-ana0public",
	"svc-studio0pub",
];

/** The handles the sitemap lists: public people, teams and businesses. */
export const SITEMAP_FIXTURE_LISTED_HANDLES: readonly string[] = ["@acme", "@ana", "@studio"];

/** Every slug and handle in the fixture that must never be listed, each with why. */
export const SITEMAP_FIXTURE_REFUSED: Readonly<Record<string, string>> = {
	"svc-ana00draft": "a draft listing",
	"svc-ana0paused": "a paused listing",
	"prd-ana0archiv": "an archived product",
	"art-ana00draft": "a draft post",
	"svc-ula0public": "a published listing whose owner is unlisted",
	"svc-hush00team": "a published listing whose team is unlisted",
	"svc-ghost00pub": "a published listing whose owner is private (not in the directory)",
	"art-mia0minor0": "a published post by a 13–17 account (never public, Decision #208)",
	"prj-acme0brief": "a public project brief",
	"@ula": "an unlisted adult",
	"@mia": "a 13–17 account",
	"@hush": "an unlisted team",
	"@ghost": "a private profile",
};
// #endregion

// #region Rows
function profile(
	id: string,
	handle: string,
	entityType: ProfileRow["entity_type"],
	listed: boolean,
): ProfileRow {
	return {
		entity_id: id,
		entity_type: entityType,
		handle,
		name: handle,
		headline: null,
		languages: null,
		location: null,
		city: null,
		rating_as_client: null,
		reviews_as_client: 0,
		rating_as_freelancer: null,
		reviews_as_freelancer: 0,
		active_project_count: 0,
		total_project_count: 0,
		member_count: entityType === "team" || entityType === "business" ? 2 : null,
		listed,
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
	};
}

interface ListingSpec {
	slug: string;
	owner: string;
	team?: string;
	status: ListingRow["status"];
	updatedAt?: string;
}

function listingRow(spec: ListingSpec, n: number, kind: ListingRow["kind"]): ListingRow {
	return {
		id: `00000000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`,
		owner_user_id: spec.owner,
		owner_team_id: spec.team ?? null,
		kind,
		service_blueprint_id: kind === "service" ? subjectId(n) : null,
		product_id: kind === "product" ? subjectId(n) : null,
		title: spec.slug,
		description_text: "",
		category: "design",
		delivery_label: "",
		amount_cents: 10_000,
		currency: "USD",
		ticket_price_cents: null,
		session_price_cents: null,
		seats_per_session: null,
		free_revisions: null,
		extra_revision_price_cents: null,
		promoted: false,
		seo_description: null,
		status: spec.status,
		published_at: spec.status === "draft" ? null : "2026-09-01T00:00:00Z",
		created_at: "2026-09-01T00:00:00Z",
		updated_at: spec.updatedAt ?? "2026-10-01T12:00:00Z",
	};
}

function subjectId(n: number): string {
	return `00000000-0000-4000-8000-0000000d${String(n).padStart(4, "0")}`;
}

function blueprint(spec: ListingSpec, n: number): BlueprintRow {
	return {
		id: subjectId(n),
		slug: spec.slug,
		owner_type: spec.team ? "team" : "freelancer",
		owner_team_id: spec.team ?? null,
		freelancer_profile_id: spec.owner,
		delivery_model: "one_off",
		price_cents: 10_000,
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
	};
}

function product(spec: ListingSpec, n: number): ProductRow {
	return {
		id: subjectId(n),
		slug: spec.slug,
		owner_user_id: spec.owner,
		owner_team_id: spec.team ?? null,
		format: "figma",
		category: "design",
		price_cents: 2_000,
		currency: "USD",
		licence: "standard",
		attribution_required: false,
		file_manifest: [],
		compatibility: [],
		specs: {},
		span: 1,
		rating_average: 0,
		rating_count: 0,
	};
}

const SERVICES: readonly ListingSpec[] = [
	{ slug: "svc-ana0public", owner: ANA, status: "published", updatedAt: "2026-11-02T08:30:00Z" },
	{ slug: "svc-ana00draft", owner: ANA, status: "draft" },
	{ slug: "svc-ana0paused", owner: ANA, status: "paused" },
	{ slug: "svc-ula0public", owner: ULA, status: "published" },
	{ slug: "svc-studio0pub", owner: ANA, team: STUDIO, status: "published" },
	{ slug: "svc-hush00team", owner: ANA, team: HUSH, status: "published" },
	{ slug: "svc-ghost00pub", owner: GHOST, status: "published" },
];

const PRODUCTS: readonly ListingSpec[] = [
	{ slug: "prd-ana0public", owner: ANA, status: "published", updatedAt: "2026-10-20T00:00:00Z" },
	{ slug: "prd-ana0archiv", owner: ANA, status: "archived" },
];

function article(
	slug: string,
	owner: string,
	status: ListingRow["status"],
	n: number,
): CatalogInputs["articles"][number] {
	return {
		id: `00000000-0000-4000-8000-0000000e${String(n).padStart(4, "0")}`,
		slug,
		owner_user_id: owner,
		owner_team_id: null,
		title: slug,
		topic: "",
		summary: "",
		cover_file_id: null,
		read_minutes: 3,
		status,
		published_at: status === "published" ? "2026-09-10T00:00:00Z" : null,
		created_at: "2026-09-10T00:00:00Z",
		updated_at: "2026-10-05T00:00:00Z",
	};
}
// #endregion

/** The fixture catalogue, freshly assembled. */
export function sitemapFixtureCatalog(): Catalog {
	const services = SERVICES.map((spec, i) => ({ spec, n: i + 1 }));
	const products = PRODUCTS.map((spec, i) => ({ spec, n: i + 101 }));
	return assemble({
		profiles: [
			profile(ANA, "ana", "freelancer", true),
			profile(ULA, "ula", "freelancer", false),
			profile(MIA, "mia", "user", false),
			profile(STUDIO, "studio", "team", true),
			profile(HUSH, "hush", "team", false),
			profile(ACME, "acme", "business", true),
		],
		listings: [
			...services.map(({ spec, n }) => listingRow(spec, n, "service")),
			...products.map(({ spec, n }) => listingRow(spec, n, "product")),
		],
		blueprints: services.map(({ spec, n }) => blueprint(spec, n)),
		products: products.map(({ spec, n }) => product(spec, n)),
		articles: [
			article("art-ana0public", ANA, "published", 1),
			article("art-ana00draft", ANA, "draft", 2),
			article("art-mia0minor0", MIA, "published", 3),
		],
		projects: [{
			id: "00000000-0000-4000-8000-0000000f0001",
			slug: "prj-acme0brief",
			owner_user_id: ANA,
			owner_team_id: null,
			client_business_id: ACME,
			title: "A brief",
			description_text: "",
			format: "one_off",
			structure_variation: "single",
			currency: "USD",
			budget_type: null,
			budget_amount_cents: null,
			created_at: "2026-09-01T00:00:00Z",
		}],
		stages: [],
		roles: [],
		seats: [],
		media: [],
		files: [],
		listingSkills: [],
		requiredSkills: [],
		skillRows: [],
		placements: [],
	});
}
