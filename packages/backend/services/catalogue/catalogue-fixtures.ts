import type { MediaRef } from "@projective/types/files";
import type {
	BlueprintRow,
	ListingTagRow,
	ProductRow,
	ProfileRow,
} from "../explore/live-catalog.ts";
import type { ListingMediaRow } from "./listing-media.ts";
import type {
	CatalogueBlueprintRow,
	CatalogueListingRow,
	CatalogueProductRow,
} from "./live-catalogue.ts";

/**
 * catalogue-fixtures — a seller's catalogue as the database stores it, one listing per form
 * archetype and delivery model, for the tests that hold the console and discovery to ONE mapping.
 *
 * Every row carries the columns BOTH readers select (`live-catalogue` for the seller, `live-catalog`
 * for discovery), so the same rows go through `projectDetail` and through `assemble`. The set covers
 * what has drifted before: a currency with no minor unit, a team owner, a video showcase slot, a
 * missing cover, an unpriced draft, a review average needing rounding, a sponsored listing and a
 * bundle entry with no library file.
 */

// #region Ids
const MARIS = "00000000-0000-4000-8000-0000000000a1";
const NORTHLIGHT = "00000000-0000-4000-8000-0000000000a2";

/** The fixture skills (`org.skills`). */
export const FIXTURE_SKILLS = [
	{ id: "00000000-0000-4000-8000-0000000005a1", slug: "brand-identity", label: "Brand identity" },
	{ id: "00000000-0000-4000-8000-0000000005a2", slug: "figma", label: "Figma" },
	{ id: "00000000-0000-4000-8000-0000000005a3", slug: "mentoring", label: "Mentoring" },
];
// #endregion

// #region Owners
function profile(
	id: string,
	type: ProfileRow["entity_type"],
	handle: string,
	name: string,
): ProfileRow {
	return {
		entity_id: id,
		entity_type: type,
		handle,
		name,
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
		member_count: type === "team" ? 3 : null,
		listed: true,
		avatar_bucket: null,
		avatar_path: null,
		banner_bucket: null,
		banner_path: null,
		verified: type === "team",
		skills: null,
		workload: 0,
		joined_at: "2026-01-04T00:00:00Z",
		verification_tier: null,
		language_codes: null,
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

/** The seller and their team, as the public profile directory lists them. */
export const FIXTURE_PROFILES: ProfileRow[] = [
	profile(MARIS, "freelancer", "maris", "Maris Okafor"),
	profile(NORTHLIGHT, "team", "northlight", "Northlight Studio"),
];
// #endregion

// #region Media
function image(
	id: string,
	path: string,
	width: number,
	height: number,
	blurhash: string,
): MediaRef {
	return {
		id,
		bucket: "showcase",
		path: `${path}/full.webp`,
		mime: "image/webp",
		width,
		height,
		blurhash,
		color: "#33405a",
		variants: {
			sm: { bucket: "showcase", path: `${path}/sm.webp`, width: 480, height: 300 },
			md: { bucket: "showcase", path: `${path}/md.webp`, width: 1280, height: 800 },
		},
	};
}

function video(id: string, path: string): MediaRef {
	return {
		id,
		bucket: "showcase",
		path: `${path}/video.mp4`,
		mime: "video/mp4",
		width: 1920,
		height: 1080,
		duration_ms: 12_000,
		variants: { md: { bucket: "showcase", path: `${path}/md.webp`, width: 1280, height: 720 } },
	};
}

/** `files.get_public_media` for every fixture rendition. */
export const FIXTURE_REFS: ReadonlyMap<string, MediaRef> = new Map(
	[
		image(
			"00000000-0000-4000-8000-00000000f0a1",
			`${MARIS}/showcase/f0a1`,
			3200,
			2000,
			"LKO2?U%2Tw=w",
		),
		video("00000000-0000-4000-8000-00000000f0a2", `${MARIS}/showcase/f0a2`),
		image(
			"00000000-0000-4000-8000-00000000f0b1",
			`${MARIS}/showcase/f0b1`,
			2400,
			1500,
			"L6PZfSi_.AyE",
		),
		image(
			"00000000-0000-4000-8000-00000000f0c1",
			`${NORTHLIGHT}/showcase/f0c1`,
			1600,
			1000,
			"LEHV6nWB2yk8",
		),
		image(
			"00000000-0000-4000-8000-00000000f0f1",
			`${MARIS}/showcase/f0f1`,
			3000,
			2400,
			"L9AB*Ar;~qWB",
		),
	].map((ref) => [ref.id, ref]),
);

function slot(
	listingId: string,
	position: number,
	kind: "image" | "video",
	rendition: string,
	alt: string,
): ListingMediaRow {
	return {
		listing_id: listingId,
		position,
		kind,
		file_id: rendition.replace("-00000000f0", "-00000000e0"),
		rendition_file_id: rendition,
		poster_file_id: null,
		alt_text: alt,
	};
}
// #endregion

// #region Listings
/** One fixture listing: its rows, as both readers select them. */
export interface FixtureListing {
	listing: CatalogueListingRow;
	blueprint?: BlueprintRow & CatalogueBlueprintRow;
	product?: ProductRow & CatalogueProductRow;
	media: ListingMediaRow[];
	skillIds: string[];
	tags: string[];
}

const STAMP = "2026-09-14T10:15:30.123Z";

function listingRow(
	n: number,
	kind: "service" | "product",
	subject: string,
	fields: Partial<CatalogueListingRow>,
): CatalogueListingRow {
	return {
		id: `00000000-0000-4000-8000-0000000c000${n}`,
		owner_user_id: MARIS,
		owner_team_id: null,
		kind,
		status: "published",
		service_blueprint_id: kind === "service" ? subject : null,
		product_id: kind === "product" ? subject : null,
		title: "",
		description: { html: "<p>A listing.</p>" },
		description_text: "A listing.",
		category: "design",
		delivery_label: "",
		amount_cents: 0,
		ticket_price_cents: null,
		session_price_cents: null,
		seats_per_session: null,
		currency: "USD",
		free_revisions: null,
		extra_revision_price_cents: null,
		promoted: false,
		view_count: 40,
		seo_title: null,
		seo_description: null,
		create_category: "create",
		published_at: "2026-09-01T09:00:00Z",
		created_at: "2026-08-28T09:00:00Z",
		updated_at: STAMP,
		...fields,
	};
}

function blueprintRow(
	id: string,
	slug: string,
	model: BlueprintRow["delivery_model"],
	listing: CatalogueListingRow,
	fields: Partial<BlueprintRow & CatalogueBlueprintRow>,
): BlueprintRow & CatalogueBlueprintRow {
	return {
		id,
		slug,
		owner_type: listing.owner_team_id ? "team" : "freelancer",
		owner_team_id: listing.owner_team_id,
		freelancer_profile_id: listing.owner_user_id,
		delivery_model: model,
		price_cents: listing.amount_cents,
		ticket_price_cents: listing.ticket_price_cents,
		session_price_cents: listing.session_price_cents,
		currency: listing.currency,
		free_revisions: listing.free_revisions,
		extra_revision_price_cents: listing.extra_revision_price_cents,
		max_seats_per_cohort: 1,
		allow_continuous_enrollment: false,
		intake_fields: [],
		stage_template: [],
		team_roles: [],
		deliverables: [],
		turnaround_days: null,
		session_minutes: null,
		session_count: null,
		meeting_provider: null,
		availability_preset_id: null,
		rating_average: null,
		rating_count: 0,
		...fields,
	};
}

const PIPELINE = listingRow(1, "service", "00000000-0000-4000-8000-0000000b0001", {
	title: "Brand system pipeline",
	delivery_label: "Rolling tickets",
	ticket_price_cents: 60_000,
	free_revisions: 2,
	extra_revision_price_cents: 15_000,
	promoted: true,
	seo_description: "A brand system delivered ticket by ticket.",
});
const ONE_OFF = listingRow(2, "service", "00000000-0000-4000-8000-0000000b0002", {
	title: "Logo sprint",
	delivery_label: "7-day delivery",
	amount_cents: 120_000,
	currency: "GBP",
	published_at: null,
	created_at: "2026-08-30T12:00:00Z",
});
const DIRECT = listingRow(3, "service", "00000000-0000-4000-8000-0000000b0003", {
	owner_team_id: NORTHLIGHT,
	title: "Launch film edit",
	delivery_label: "3-week delivery",
	amount_cents: 450_000,
	currency: "EUR",
});
const SESSION = listingRow(4, "service", "00000000-0000-4000-8000-0000000b0004", {
	title: "Portfolio review call",
	delivery_label: "45-minute session",
	session_price_cents: 9_000,
});
const COHORT = listingRow(5, "service", "00000000-0000-4000-8000-0000000b0005", {
	title: "Figma systems workshop",
	delivery_label: "4 weekly sittings",
	session_price_cents: 4_500,
	seats_per_session: 12,
});
const PRODUCT = listingRow(6, "product", "00000000-0000-4000-8000-0000000d0006", {
	title: "Dashboard UI kit",
	delivery_label: "Instant download",
	amount_cents: 5_000,
	currency: "JPY",
	category: "ui-kits",
});
const DRAFT = listingRow(7, "product", "00000000-0000-4000-8000-0000000d0007", {
	status: "draft",
	title: "Sketch brush pack",
	delivery_label: "Instant download",
	published_at: null,
	category: "brushes",
});

function productRow(
	id: string,
	slug: string,
	listing: CatalogueListingRow,
	fields: Partial<ProductRow & CatalogueProductRow>,
): ProductRow & CatalogueProductRow {
	return {
		id,
		slug,
		owner_user_id: listing.owner_user_id,
		owner_team_id: listing.owner_team_id,
		format: "download",
		category: listing.category,
		price_cents: listing.amount_cents,
		currency: listing.currency,
		licence: "personal",
		attribution_required: false,
		file_manifest: [],
		compatibility: [],
		specs: [],
		span: 1,
		rating_average: null,
		rating_count: 0,
		...fields,
	};
}

/** Every fixture listing, in the order a seller created them. */
export const FIXTURE_LISTINGS: FixtureListing[] = [
	{
		listing: PIPELINE,
		blueprint: blueprintRow(
			"00000000-0000-4000-8000-0000000b0001",
			"svc-brandpipe01",
			"pipeline",
			PIPELINE,
			{
				stage_template: [
					{
						name: "Discovery",
						deliverables: ["Brief"],
						skills: [],
						startTrigger: "on_project_start",
						lagDays: 0,
						chainReaction: true,
					},
					{
						name: "Identity",
						deliverables: ["Logo suite"],
						skills: [],
						startTrigger: "fixed_offset",
						lagDays: 3,
						chainReaction: false,
					},
				],
				team_roles: [{ name: "Art director", summary: "", skills: [], count: 1 }],
				rating_average: "4.8",
				rating_count: 12,
			},
		),
		media: [
			slot(PIPELINE.id, 2, "video", "00000000-0000-4000-8000-00000000f0a2", "Process reel"),
			slot(PIPELINE.id, 1, "image", "00000000-0000-4000-8000-00000000f0a1", "Brand board"),
		],
		skillIds: [FIXTURE_SKILLS[0].id, FIXTURE_SKILLS[1].id],
		tags: ["branding", "identity"],
	},
	{
		listing: ONE_OFF,
		blueprint: blueprintRow(
			"00000000-0000-4000-8000-0000000b0002",
			"svc-logosprint1",
			"one_off",
			ONE_OFF,
			{
				stage_template: [{
					name: "Concepts",
					description: "",
					deliverables: [],
					skills: [],
					priceCents: 60_000,
				}],
				deliverables: ["Three concepts", "Two revision rounds"],
				turnaround_days: 7,
			},
		),
		media: [slot(ONE_OFF.id, 1, "image", "00000000-0000-4000-8000-00000000f0b1", "")],
		skillIds: [FIXTURE_SKILLS[0].id],
		tags: [],
	},
	{
		listing: DIRECT,
		blueprint: blueprintRow(
			"00000000-0000-4000-8000-0000000b0003",
			"svc-launchfilm1",
			"direct_deliverable",
			DIRECT,
			{
				team_roles: [{ name: "Editor", summary: "Cuts the film", skills: [], count: 2 }],
				turnaround_days: 21,
			},
		),
		media: [slot(DIRECT.id, 1, "image", "00000000-0000-4000-8000-00000000f0c1", "Film still")],
		skillIds: [],
		tags: ["video"],
	},
	{
		listing: SESSION,
		blueprint: blueprintRow(
			"00000000-0000-4000-8000-0000000b0004",
			"svc-reviewcall",
			"session",
			SESSION,
			{
				session_minutes: 45,
				session_count: 1,
				meeting_provider: "zoom",
			},
		),
		media: [],
		skillIds: [FIXTURE_SKILLS[2].id],
		tags: [],
	},
	{
		listing: COHORT,
		blueprint: blueprintRow(
			"00000000-0000-4000-8000-0000000b0005",
			"svc-figmacohort",
			"group_session",
			COHORT,
			{
				session_minutes: 90,
				session_count: 4,
				max_seats_per_cohort: 12,
				allow_continuous_enrollment: true,
				rating_average: 4.8333,
				rating_count: 6,
			},
		),
		media: [],
		skillIds: [FIXTURE_SKILLS[1].id, FIXTURE_SKILLS[2].id],
		tags: ["workshop"],
	},
	{
		listing: PRODUCT,
		product: productRow("00000000-0000-4000-8000-0000000d0006", "prd-dashkit001", PRODUCT, {
			format: "template",
			licence: "commercial",
			attribution_required: true,
			span: 2,
			file_manifest: [
				{
					name: "dashboard.fig",
					label: "Figma file",
					extension: ".fig",
					bytes: 4_200_000,
					fileId: "00000000-0000-4000-8000-0000000fe001",
				},
				{ name: "README.md", label: "Read me", extension: ".md", bytes: 2_000 },
			],
		}),
		media: [slot(PRODUCT.id, 1, "image", "00000000-0000-4000-8000-00000000f0f1", "Kit overview")],
		skillIds: [FIXTURE_SKILLS[1].id],
		tags: ["ui kit"],
	},
	{
		listing: DRAFT,
		product: productRow("00000000-0000-4000-8000-0000000d0007", "prd-brushpack1", DRAFT, {
			span: 3,
		}),
		media: [],
		skillIds: [],
		tags: [],
	},
];

/** The listing tags of every fixture listing. */
export function fixtureTags(): ListingTagRow[] {
	return FIXTURE_LISTINGS.flatMap((f) => f.tags.map((tag) => ({ listing_id: f.listing.id, tag })));
}
// #endregion
