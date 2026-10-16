import type { SupabaseClient } from "supabaseClient";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { resolveSkill } from "./skills.ts";
import {
	byScore,
	priorMeanOf,
	type RankingWeights,
	type RankSignals,
	resolveWeights,
	scoreItem,
} from "./ranking.ts";
import { workloadPercent } from "../workspace/mappers.ts";
import {
	type ArticleItem,
	type DiscoveryEntityKind,
	displayPrice,
	type DualRating,
	type ExploreItem,
	type ExploreOwner,
	listingCardItem,
	type ListingCardSource,
	type ProductItem,
	type ProfileItem,
	type ProjectItem,
	type RankingWeightRow,
	type ServiceItem,
	type ServiceType,
	type SkillRef,
	type TrendingEntityRow,
} from "@projective/types/explore";
import type { ImagePlaceholder, MediaRef } from "@projective/types/files";
import { toMajorUnits } from "@projective/types/finance";
import { type VerificationStamp, VerificationStampSchema } from "@projective/types/org";
import { fetchPublicMedia } from "../files/public-media.ts";
import {
	LISTING_MEDIA_COLUMNS,
	listingMediaFileIds,
	type ListingMediaRow,
	listingMediaSlots,
	mediaRowsByListing,
} from "../catalogue/listing-media.ts";

export { displayPrice } from "@projective/types/explore";

/**
 * live-catalog — the discovery corpus, read from Postgres.
 *
 * ## One load, every discovery surface
 *
 * `/explore` (search and home), the `/view/[id]` pages, the landing showcase and the profile's
 * Services/Products rows all render the same thing — the PUBLIC marketplace — so they share one read
 * of it. {@link loadCatalog} fetches every published listing, product, article, public project and
 * listed profile, maps each onto the `ExploreItem` shape the cards already render, and keeps the
 * result for {@link CATALOG_TTL_MS}. The pure query layer (`./query.ts`) then filters, ranks and
 * groups that list exactly as it always has; only the SOURCE of the list changed.
 *
 * ## Why the anon client
 *
 * Everything here is public by definition, so it is read as `anon`: the answer is the same for every
 * viewer, which is what makes one process-wide cache entry correct. Reading it with a viewer's token
 * would let their own drafts leak into a cache every other visitor is served from. RLS still decides
 * what `anon` sees (00002020 · 00002011 · 00002018), and the profile directory is the column-level
 * definer view `org.profiles_index` (00003001) — this module never touches `org.users_public`.
 *
 * ## Ranked at load
 *
 * The same load reads the ranking signals — active discovery-rank penalties (`search.profiles_index`),
 * the coefficients (`search.ranking_weights()`) and the k-anonymous Trending aggregate
 * (`search.trending_entities()`) — and scores every item once (`./ranking.ts`), so `items` arrives in
 * recommended order and no request re-scores. Each is public by construction (a cache, a definer door
 * projecting coefficients, an aggregate floored at three people), which is what keeps this load
 * anonymous and its cache shared. Anything about ONE viewer belongs to the viewer pass
 * (`./viewer-signals.ts`), read under that viewer's own token and never cached here.
 *
 * ## Never invent
 *
 * A field no column backs is ABSENT, not guessed: there is no measured reply time, so
 * `responseMinutes` is omitted; an owner with no avatar gets `""` and the card draws their initials;
 * a listing with no reviews carries no rating. The previous corpus filled every one of those in, and
 * every filled-in value was a claim nobody could stand behind.
 *
 * ## Scale
 *
 * Load-then-filter is right for a marketplace of this size and wrong for a large one: past a few
 * thousand listings the filtering belongs in SQL (the `search.*_index` tables and their `fts`
 * vectors exist for exactly that). The seam is {@link loadCatalog} — the query layer consumes a list
 * and does not care where it came from.
 */

// #region Row shapes (the columns this module selects)

/**
 * A directory row's `verification_stamp`, parsed. An unknown value is ABSENT, never `none`, so the
 * renderer falls back to `stampForVerifiedOwner` rather than erasing a crest it cannot read.
 */
export function stampOf(raw: string | null | undefined): VerificationStamp | undefined {
	const parsed = VerificationStampSchema.safeParse(raw);
	return parsed.success ? parsed.data : undefined;
}

/** One row of the public profile directory (`org.profiles_index`). */
export interface ProfileRow {
	entity_id: string;
	entity_type: "user" | "freelancer" | "team" | "business";
	handle: string;
	name: string;
	headline: string | null;
	languages: string[] | null;
	location: string | null;
	city: string | null;
	rating_as_client: number | string | null;
	reviews_as_client: number | null;
	rating_as_freelancer: number | string | null;
	reviews_as_freelancer: number | null;
	active_project_count: number | null;
	total_project_count: number | null;
	member_count: number | null;
	listed: boolean;
	avatar_bucket: string | null;
	avatar_path: string | null;
	banner_bucket: string | null;
	banner_path: string | null;
	verified: boolean;
	skills: string[] | null;
	workload: number | null;
	joined_at: string;
	/** The attained verification level (1–3) once verified, else null. */
	verification_tier: number | null;
	/** Language codes (`EN`), strongest first. */
	language_codes: string[] | null;
	/** Stages this entity has delivered (completed assignments). */
	delivered_count: number | null;
	/**
	 * Showcase slot 1 — the profile's primary thumbnail, which every card of it leads with (the
	 * profile owner chooses it in the editor). `null` when the slot is empty; the card falls back to
	 * the banner.
	 */
	showcase_bucket: string | null;
	showcase_path: string | null;
	/**
	 * A seller's earned Standing rung (a freelancer or a team) — level 1 "New" until one is computed;
	 * `null` for a buyer, which has no seller standing.
	 */
	standing_level: number | null;
	standing_label: string | null;
	/** The rung's discovery multiplier in basis points (10000 = 1.0×); `null` for a buyer. */
	discovery_weight_bp: number | null;
	/**
	 * The Global Intensity Cap `workload` is measured against — the seller's own override, else the
	 * platform default; a team's is its members' combined. `null` for a buyer. `numeric`, so PostgREST
	 * may send it as text.
	 */
	workload_cap: number | string | null;
	/** The owner's verification crest — the same derivation `org.get_profile_view` uses. */
	verification_stamp: string | null;
}

interface ListingRow {
	id: string;
	owner_user_id: string;
	owner_team_id: string | null;
	kind: "service" | "product";
	service_blueprint_id: string | null;
	product_id: string | null;
	title: string;
	description_text: string;
	category: string;
	delivery_label: string;
	amount_cents: number;
	currency: string;
	ticket_price_cents: number | null;
	session_price_cents: number | null;
	seats_per_session: number | null;
	free_revisions: number | null;
	extra_revision_price_cents: number | null;
	promoted: boolean;
	seo_description: string | null;
	status: "draft" | "published" | "paused" | "archived";
	published_at: string | null;
	created_at: string;
	updated_at: string;
}

/**
 * A single-listing read made AS ITS OWNER: their token, so RLS shows them their own draft or paused
 * listing, and `owns` decides that this listing is theirs to see before anything maps.
 */
export interface OwnerRead {
	accessToken: string;
	owns(listing: { owner_user_id: string; owner_team_id: string | null }): boolean;
	/** The session client to read with; defaults to one bound to `accessToken` (a test passes a stub). */
	client?: SupabaseClient;
}

/** The blueprint columns every discovery surface and the view page read. */
export interface BlueprintRow {
	id: string;
	slug: string;
	owner_type: string;
	owner_team_id: string | null;
	freelancer_profile_id: string;
	delivery_model: "pipeline" | "one_off" | "direct_deliverable" | "session" | "group_session";
	price_cents: number;
	ticket_price_cents: number | null;
	session_price_cents: number | null;
	currency: string;
	free_revisions: number | null;
	extra_revision_price_cents: number | null;
	max_seats_per_cohort: number;
	intake_fields: unknown;
	stage_template: unknown;
	team_roles: unknown;
	deliverables: string[] | null;
	session_minutes: number | null;
	session_count: number | null;
	rating_average: number | string | null;
	rating_count: number | null;
}

/** The product columns every discovery surface and the view page read. */
export interface ProductRow {
	id: string;
	slug: string;
	owner_user_id: string;
	owner_team_id: string | null;
	format: string;
	category: string;
	price_cents: number;
	currency: string;
	licence: string;
	attribution_required: boolean;
	file_manifest: unknown;
	compatibility: unknown;
	specs: unknown;
	span: number;
	rating_average: number | string | null;
	rating_count: number | null;
}

/** The article columns every discovery surface and the view page read. */
export interface ArticleRow {
	id: string;
	slug: string;
	owner_user_id: string;
	owner_team_id: string | null;
	title: string;
	topic: string;
	summary: string;
	body: unknown;
	cover_file_id: string | null;
	read_minutes: number;
	published_at: string | null;
	created_at: string;
}

/** The public project columns every discovery surface and the view page read. */
export interface ProjectRow {
	id: string;
	slug: string;
	owner_user_id: string;
	owner_team_id: string | null;
	client_business_id: string | null;
	title: string;
	description_text: string;
	format: string;
	structure_variation: string;
	currency: string;
	budget_type: string | null;
	budget_amount_cents: number | null;
	created_at: string;
}

/** A public project's stage, as the discovery card and the project view read it. */
export interface StageRow {
	id: string;
	project_id: string;
	name: string;
	slug: string;
	description_text: string | null;
	sort_order: number;
	status: string;
	skills: string[] | null;
	unit_price_cents: number | null;
	seat_count: number | null;
	seat_limit: number | null;
	parallel: boolean | null;
	/** Whether the stage is hiring at all — `projects.apply_to_project` refuses a stage with it off. */
	hire_trigger_active: boolean | null;
}

/** A named staffing role on a public project's stage. */
export interface StaffingRoleRow {
	id: string;
	project_stage_id: string;
	role_title: string;
	quantity: number | null;
	budget_amount_cents: number | null;
	skills: string[] | null;
	/** Whether the role takes proposals — only such a role can be named by an application. */
	allow_proposals: boolean | null;
}

/** An open seat on a public project's stage. */
export interface OpenSeatRow {
	id: string;
	project_stage_id: string;
	description_of_need: string | null;
	budget_min_cents: number | null;
	budget_max_cents: number | null;
	status: string | null;
}

/** One search tag of a listing (`catalogue.listing_tags`). */
export interface ListingTagRow {
	listing_id: string;
	tag: string;
}

/** The stored-object facts an image URL and its placeholder are built from. */
export interface FileRow {
	id: string;
	bucket_id: string | null;
	storage_path: string | null;
	metadata: Record<string, unknown> | null;
}

interface PlacementRow {
	entity_type: string;
	entity_id: string;
	surface: PlacementSurface;
}

/** The inventory slot a placement was bought for (`promoted_placements_surface_check`). */
export type PlacementSurface = "explore_home" | "explore_results" | "view_rail";

/** One active paid placement, resolved to the discovery item it promotes. */
export interface CatalogPlacement {
	surface: PlacementSurface;
	itemId: string;
}

/** A penalised entity's active discovery-rank severity (`search.profiles_index`, positive rows only). */
export interface PenaltyRow {
	entity_id: string;
	discovery_penalty: number | string;
}

// #endregion

// #region The loaded catalogue

/** One gallery frame of a listing, resolved to a URL. */
export interface CatalogMedia {
	/** The full view: an image's large tier, or the video itself. */
	src: string;
	/** The tile still: an image's small tier, or a video's poster. */
	thumb: string;
	kind: "image" | "video";
	alt: string;
	placeholder?: ImagePlaceholder;
	width: number | null;
	height: number | null;
}

/** What a listing is FOUND by beyond its card: its search tags and its search-result description. */
export interface ListingSearchTerms {
	tags: string[];
	/** The seller's search-result description; empty when they kept the fallback. */
	seoDescription: string;
}

/** The database entity behind a discovery item, in the discovery-signal vocabulary (views, saves). */
export interface CatalogEntity {
	kind: DiscoveryEntityKind;
	/** The entity's uuid — a blueprint, product, article, project, or profile entity id. */
	id: string;
}

/** The lookup key {@link Catalog.itemIdByEntity} is keyed by. */
export function entityKey(kind: string, id: string): string {
	return `${kind}:${id}`;
}

/** Everything a discovery surface reads, loaded once and shared. */
export interface Catalog {
	/**
	 * Every discoverable item, in RECOMMENDED order — best discovery score first (`./ranking.ts`), so a
	 * filter over it keeps that order and a stable sort's ties fall back to it.
	 */
	items: ExploreItem[];
	/** Item id → its discovery quality score. */
	scoreById: Map<string, number>;
	/** The coefficients that score was computed with — the viewer pass ranks with the same ones. */
	weights: RankingWeights;
	/** Item id → the database entity behind it. */
	entityById: Map<string, CatalogEntity>;
	/** {@link entityKey} → item id: resolves a view, a save or a trending row back to a live item. */
	itemIdByEntity: Map<string, string>;
	/**
	 * What three or more people opened or saved in the last {@link TRENDING_WINDOW_DAYS} days, most
	 * active first, as item ids (`search.trending_entities`). Anything no longer published is dropped.
	 */
	trending: string[];
	/** Item id (slug / handle) → item. */
	byId: Map<string, ExploreItem>;
	/** Service item id → its blueprint row (the view page's service extension reads it). */
	blueprintBySlug: Map<string, BlueprintRow>;
	/** Product item id → its product row. */
	productBySlug: Map<string, ProductRow>;
	/** Article item id → its article row. */
	articleBySlug: Map<string, ArticleRow>;
	/** Project item id → its project row, stages, staffing roles and open seats. */
	projectBySlug: Map<
		string,
		{ row: ProjectRow; stages: StageRow[]; roles: StaffingRoleRow[]; seats: OpenSeatRow[] }
	>;
	/** Item id → its ordered gallery (listings and articles). */
	galleryById: Map<string, CatalogMedia[]>;
	/** Item id → the catalogue listing id behind it (services and products). */
	listingIdById: Map<string, string>;
	/** Item id → the listing's search terms (services and products), for the embedding text. */
	listingTermsById: Map<string, ListingSearchTerms>;
	/** Owner `@handle` → the profile row (for seller facts on the view page). */
	profileByHandle: Map<string, ProfileRow>;
	/** Entity id (user / team / business uuid) → the profile row (review authors, project clients). */
	profileById: Map<string, ProfileRow>;
	/** The subject ids (blueprint / product uuid) of every active paid placement. */
	sponsoredSubjects: Set<string>;
	/** Every active placement on a published listing, oldest flight first. */
	placements: CatalogPlacement[];
	/** When this load completed. */
	loadedAt: number;
}

/** How long one load serves every request. Short: a seller's publish should appear quickly. */
export const CATALOG_TTL_MS = 30_000;

/** The Trending window, in days. */
export const TRENDING_WINDOW_DAYS = 7;

/** How many trending entities one load asks for — more than a rail shows, since some may be unpublished. */
const TRENDING_READ_LIMIT = 48;

/** Logged once per process, not once per load: a database seeded before a coefficient existed. */
let reportedMissingWeights = false;

let cached: { at: number; value: Promise<Catalog> } | null = null;
/** The last catalogue that loaded successfully — served by {@link peekCatalog} even once expired. */
let latest: Catalog | null = null;

/**
 * The public discovery catalogue — from cache when fresh, else one load shared by every concurrent
 * caller (the in-flight promise is what is cached, so a burst of requests after expiry triggers ONE
 * read, not one each). A failed load is not cached: the next request retries rather than being
 * served the failure for the whole TTL.
 */
export function loadCatalog(): Promise<Catalog> {
	const now = Date.now();
	if (cached && now - cached.at < CATALOG_TTL_MS) return cached.value;
	const value = readCatalog().then((catalog) => {
		latest = catalog;
		return catalog;
	}).catch((error) => {
		if (cached?.value === value) cached = null;
		throw error;
	});
	cached = { at: now, value };
	return value;
}

/** Drop the cached catalogue — called after any write that changes what is published. */
export function invalidateCatalog(): void {
	cached = null;
}

/**
 * The most recently loaded catalogue, synchronously — or `null` before the first load completes.
 *
 * For the few synchronous callers that cannot await (see `query.ts findItem`). It may be up to one
 * TTL stale, which is acceptable for RESOLVING an id and wrong for RENDERING a list: every surface that
 * shows the catalogue awaits {@link loadCatalog}.
 */
export function peekCatalog(): Catalog | null {
	return latest;
}

/**
 * Make sure {@link peekCatalog} has something to answer with — for the routes whose services still
 * resolve a listing synchronously (booking, instantiate, the session schedule). A failure is swallowed:
 * the service then answers "not found" for the listing, which is the correct degraded state of a
 * route whose catalogue could not be read, and the route must not throw instead.
 */
export async function warmCatalog(): Promise<void> {
	try {
		await loadCatalog();
	} catch {
		// Reported by the next awaited read; the sync caller degrades to "not found".
	}
}

/**
 * Install a catalogue as the latest snapshot WITHOUT reading the database — for unit tests only. Build
 * one from rows with {@link assemble}. `null` clears it. By default the next awaited
 * {@link loadCatalog} still reads the database and only {@link peekCatalog} changes; with `serve` the
 * awaited loads answer with it too for one TTL, for service-level tests that must not reach Postgres.
 */
export function primeCatalogForTesting(
	catalog: Catalog | null,
	options: { serve?: boolean } = {},
): void {
	latest = catalog;
	cached = catalog && options.serve ? { at: Date.now(), value: Promise.resolve(catalog) } : null;
}

// #endregion

// #region Reads

/*
 * The project-shaped column lists, named once. Both the public catalogue read and the owner's
 * preview read ({@link readProjectPreview}) select through these, so the brief an owner previews and
 * the brief a freelancer opens are mapped from the same columns by the same {@link assemble} — a
 * second list would be a second mapping, and the preview would drift from the page it promises to
 * mirror the first time one of them gained a column.
 */
const PROJECT_COLUMNS =
	"id, slug, owner_user_id, owner_team_id, client_business_id, title, description_text, format, structure_variation, currency, budget_type, budget_amount_cents, created_at";
const STAGE_COLUMNS =
	"id, project_id, name, slug, description_text, sort_order, status, skills, unit_price_cents, seat_count, seat_limit, parallel, hire_trigger_active";
const STAFFING_ROLE_COLUMNS =
	"id, project_stage_id, role_title, quantity, budget_amount_cents, skills, allow_proposals";
const OPEN_SEAT_COLUMNS =
	"id, project_stage_id, description_of_need, budget_min_cents, budget_max_cents, status";

/*
 * The listing-shaped column lists, named once for the same reason: the public catalogue load and the
 * single-listing read ({@link readListing}) map a listing through one {@link assemble}, so they must
 * select the same columns.
 */
const LISTING_COLUMNS =
	"id, owner_user_id, owner_team_id, kind, service_blueprint_id, product_id, title, description_text, category, delivery_label, amount_cents, currency, ticket_price_cents, session_price_cents, seats_per_session, free_revisions, extra_revision_price_cents, promoted, seo_description, status, published_at, created_at, updated_at";
const BLUEPRINT_COLUMNS =
	"id, slug, owner_type, owner_team_id, freelancer_profile_id, delivery_model, price_cents, ticket_price_cents, session_price_cents, currency, free_revisions, extra_revision_price_cents, max_seats_per_cohort, intake_fields, stage_template, team_roles, deliverables, session_minutes, session_count, rating_average, rating_count";
const PRODUCT_COLUMNS =
	"id, slug, owner_user_id, owner_team_id, format, category, price_cents, currency, licence, attribution_required, file_manifest, compatibility, specs, span, rating_average, rating_count";
const FILE_COLUMNS = "id, bucket_id, storage_path, metadata";

/** Throw a load failure with the table named, so a broken policy is diagnosable from the log. */
function fail(table: string, message: string): never {
	throw new Error(`explore catalogue: reading ${table} failed — ${message}`);
}

/** `select … where id in (…)`, chunked so a long id list never exceeds a URL's length. */
async function byIds<T>(
	db: SupabaseClient,
	schema: string,
	table: string,
	columns: string,
	column: string,
	ids: readonly string[],
): Promise<T[]> {
	const unique = [...new Set(ids.filter((id) => !!id))];
	const out: T[] = [];
	for (let i = 0; i < unique.length; i += 100) {
		const chunk = unique.slice(i, i + 100);
		const { data, error } = await db.schema(schema).from(table).select(columns).in(column, chunk);
		if (error) fail(`${schema}.${table}`, error.message);
		out.push(...((data ?? []) as T[]));
	}
	return out;
}

async function readCatalog(): Promise<Catalog> {
	const db = getAnonClient();

	const [
		profilesRes,
		listingsRes,
		articlesRes,
		projectsRes,
		placementsRes,
		skillsRes,
		penaltiesRes,
		weightsRes,
		trendingRes,
	] = await Promise
		.all([
			db.schema("org").from("profiles_index").select(
				"entity_id, entity_type, handle, name, headline, languages, location, city, rating_as_client, reviews_as_client, rating_as_freelancer, reviews_as_freelancer, active_project_count, total_project_count, member_count, listed, avatar_bucket, avatar_path, banner_bucket, banner_path, verified, skills, workload, joined_at, verification_tier, language_codes, delivered_count, showcase_bucket, showcase_path, standing_level, standing_label, discovery_weight_bp, workload_cap, verification_stamp",
			),
			db.schema("catalogue").from("listings").select(
				LISTING_COLUMNS,
			).eq("status", "published"),
			db.schema("catalogue").from("articles").select(
				"id, slug, owner_user_id, owner_team_id, title, topic, summary, body, cover_file_id, read_minutes, published_at, created_at",
			).eq("status", "published"),
			db.schema("projects").from("projects").select(PROJECT_COLUMNS).eq("status", "active").eq(
				"visibility",
				"public",
			),
			db.schema("marketplace").from("promoted_placements")
				.select("entity_type, entity_id, surface")
				.order("starts_at", { ascending: true }),
			db.schema("org").from("skills").select("id, slug, label"),
			// The trust penalty's denormalised cache (security.fn_recalc_penalty_aggregates keeps it).
			db.schema("search").from("profiles_index").select("entity_id, discovery_penalty")
				.gt("discovery_penalty", 0),
			db.schema("search").rpc("ranking_weights"),
			db.schema("search").rpc("trending_entities", {
				p_days: TRENDING_WINDOW_DAYS,
				p_limit: TRENDING_READ_LIMIT,
			}),
		]);
	if (profilesRes.error) fail("org.profiles_index", profilesRes.error.message);
	if (listingsRes.error) fail("catalogue.listings", listingsRes.error.message);
	if (articlesRes.error) fail("catalogue.articles", articlesRes.error.message);
	if (projectsRes.error) fail("projects.projects", projectsRes.error.message);
	if (placementsRes.error) fail("marketplace.promoted_placements", placementsRes.error.message);
	if (skillsRes.error) fail("org.skills", skillsRes.error.message);
	if (penaltiesRes.error) fail("search.profiles_index", penaltiesRes.error.message);
	if (weightsRes.error) fail("search.ranking_weights()", weightsRes.error.message);
	if (trendingRes.error) fail("search.trending_entities()", trendingRes.error.message);

	const weightRows = (weightsRes.data ?? []) as RankingWeightRow[];
	const { missing } = resolveWeights(weightRows);
	if (missing.length > 0 && !reportedMissingWeights) {
		reportedMissingWeights = true;
		console.warn(
			`[explore] search.search_weights holds no row for ${
				missing.join(", ")
			}; those factors score 0 until the reference seed (00005050) is applied.`,
		);
	}

	const profiles = (profilesRes.data ?? []) as ProfileRow[];
	const listings = (listingsRes.data ?? []) as ListingRow[];
	const articles = (articlesRes.data ?? []) as ArticleRow[];
	const projects = (projectsRes.data ?? []) as ProjectRow[];
	const placements = (placementsRes.data ?? []) as PlacementRow[];
	const skillRows = (skillsRes.data ?? []) as Array<{ id: string; slug: string; label: string }>;

	const blueprintIds = listings.map((l) => l.service_blueprint_id).filter((x): x is string => !!x);
	const productIds = listings.map((l) => l.product_id).filter((x): x is string => !!x);
	const listingIds = listings.map((l) => l.id);
	const projectIds = projects.map((p) => p.id);

	const [blueprints, products, media, listingSkills, stages, requiredSkills, listingTags] =
		await Promise.all([
			byIds<BlueprintRow>(
				db,
				"marketplace",
				"service_blueprints",
				BLUEPRINT_COLUMNS,
				"id",
				blueprintIds,
			),
			byIds<ProductRow>(
				db,
				"catalogue",
				"products",
				PRODUCT_COLUMNS,
				"id",
				productIds,
			),
			byIds<ListingMediaRow>(
				db,
				"catalogue",
				"listing_media",
				LISTING_MEDIA_COLUMNS,
				"listing_id",
				listingIds,
			),
			byIds<{ listing_id: string; skill_id: string }>(
				db,
				"catalogue",
				"listing_skills",
				"listing_id, skill_id",
				"listing_id",
				listingIds,
			),
			byIds<StageRow>(
				db,
				"projects",
				"project_stages",
				STAGE_COLUMNS,
				"project_id",
				projectIds,
			),
			byIds<{ project_id: string; skill_id: string }>(
				db,
				"projects",
				"project_required_skills",
				"project_id, skill_id",
				"project_id",
				projectIds,
			),
			byIds<ListingTagRow>(
				db,
				"catalogue",
				"listing_tags",
				"listing_id, tag",
				"listing_id",
				listingIds,
			),
		]);

	const stageIds = stages.map((s) => s.id);
	const fileIds = articles.map((a) => a.cover_file_id).filter((x): x is string => !!x);
	const [roles, seats, files, mediaRefs] = await Promise.all([
		byIds<StaffingRoleRow>(
			db,
			"projects",
			"stage_staffing_roles",
			STAFFING_ROLE_COLUMNS,
			"project_stage_id",
			stageIds,
		),
		byIds<OpenSeatRow>(
			db,
			"projects",
			"stage_open_seats",
			OPEN_SEAT_COLUMNS,
			"project_stage_id",
			stageIds,
		),
		byIds<FileRow>(db, "files", "items", FILE_COLUMNS, "id", fileIds),
		fetchPublicMedia(db, listingMediaFileIds(media)),
	]);

	return assemble({
		profiles,
		listings,
		blueprints,
		products,
		articles,
		projects,
		stages,
		roles,
		seats,
		media,
		mediaRefs,
		files,
		listingSkills,
		listingTags,
		requiredSkills,
		skillRows,
		placements,
		penalties: (penaltiesRes.data ?? []) as PenaltyRow[],
		weights: weightRows,
		trending: (trendingRes.data ?? []) as TrendingEntityRow[],
	});
}

/**
 * One project, read AS ITS OWNER, mapped exactly as the public catalogue maps a project — the source
 * of the owner's brief preview (`/projects/[slug]/preview`).
 *
 * The catalogue cannot answer this: it holds `active` + `public` projects only, so a draft — the very
 * thing an owner previews before publishing — is not in it, and a published brief in it can be up to
 * one TTL behind the edit the owner just made. So this reads the rows fresh with the owner's own token
 * (RLS decides; nothing here widens what they can see) and runs them through {@link assemble} beside
 * the loaded catalogue's profile directory, so the owner, client and skill labels resolve from the
 * same rows a freelancer's page resolves them from.
 *
 * Never cached and never merged into the shared catalogue: it is one viewer's answer, read with one
 * viewer's token, and the module header explains why that must not reach the process-wide entry.
 *
 * `null` when the slug matches no project the token can read.
 */
export async function readProjectPreview(
	accessToken: string,
	slug: string,
	catalog: Catalog,
): Promise<Catalog | null> {
	const db = getUserClient(accessToken);
	const { data, error } = await db.schema("projects").from("projects").select(PROJECT_COLUMNS)
		.eq("slug", slug).maybeSingle();
	if (error) fail("projects.projects", error.message);
	if (!data) return null;
	const project = data as ProjectRow;

	const [stages, requiredSkills, skillsRes] = await Promise.all([
		byIds<StageRow>(db, "projects", "project_stages", STAGE_COLUMNS, "project_id", [project.id]),
		byIds<{ project_id: string; skill_id: string }>(
			db,
			"projects",
			"project_required_skills",
			"project_id, skill_id",
			"project_id",
			[project.id],
		),
		getAnonClient().schema("org").from("skills").select("id, slug, label"),
	]);
	if (skillsRes.error) fail("org.skills", skillsRes.error.message);
	const stageIds = stages.map((s) => s.id);
	const [roles, seats] = await Promise.all([
		byIds<StaffingRoleRow>(
			db,
			"projects",
			"stage_staffing_roles",
			STAFFING_ROLE_COLUMNS,
			"project_stage_id",
			stageIds,
		),
		byIds<OpenSeatRow>(
			db,
			"projects",
			"stage_open_seats",
			OPEN_SEAT_COLUMNS,
			"project_stage_id",
			stageIds,
		),
	]);

	const single = assemble({
		profiles: [...catalog.profileById.values()],
		listings: [],
		blueprints: [],
		products: [],
		articles: [],
		projects: [project],
		stages,
		roles,
		seats,
		media: [],
		files: [],
		listingSkills: [],
		requiredSkills,
		skillRows: (skillsRes.data ?? []) as Array<{ id: string; slug: string; label: string }>,
		placements: [],
	});
	const item = single.byId.get(project.slug);
	const entry = single.projectBySlug.get(project.slug);
	if (!item || !entry) return null;

	// The loaded catalogue with this one project laid over it — a per-request copy of the two maps the
	// view composer reads a project through, never a write to the shared snapshot.
	return {
		...catalog,
		byId: new Map(catalog.byId).set(item.id, item),
		projectBySlug: new Map(catalog.projectBySlug).set(item.id, entry),
	};
}

/**
 * One PUBLISHED service or product listing, read fresh from Postgres and laid over the loaded
 * catalogue — the source the booking and instantiate paths resolve a listing from when
 * `EXPLORE_BACKEND_LIVE` is on.
 *
 * The shared catalogue is the wrong source for a WRITE: it can be a full TTL behind the seller (a
 * repriced stage, a new intake question, an unpublish), and {@link peekCatalog} serves the last good
 * load indefinitely when reloads fail. A buyer committing against a listing must be validated against
 * the listing as it stands now. This reads the listing row, its subject (blueprint or product), its
 * gallery and its skills — as `anon`, because a listing is public by definition and RLS decides what
 * `anon` sees — and maps them through {@link assemble} beside the catalogue's profile directory, so
 * the item, owner and stage template resolve exactly as the page that showed them did.
 *
 * Never merged into the shared snapshot: the overlay is a per-request copy of the maps the view
 * composer and the booking service read. `null` when the id names no published listing.
 *
 * With `asOwner` the read is the seller's PREVIEW of their own listing instead: their token, any
 * status but archived, and `null` — never a refusal that would confirm the listing exists — when it
 * is not theirs.
 */
export async function readListing(
	itemId: string,
	catalog: Catalog,
	asOwner?: OwnerRead,
): Promise<Catalog | null> {
	const kind = itemId.startsWith("svc-") ? "service" : itemId.startsWith("prd-") ? "product" : null;
	if (!kind) return null;
	const db = asOwner ? asOwner.client ?? getUserClient(asOwner.accessToken) : getAnonClient();

	let blueprint: BlueprintRow | null = null;
	let product: ProductRow | null = null;
	if (kind === "service") {
		const { data, error } = await db.schema("marketplace").from("service_blueprints")
			.select(BLUEPRINT_COLUMNS).eq("slug", itemId).maybeSingle();
		if (error) fail("marketplace.service_blueprints", error.message);
		blueprint = data as BlueprintRow | null;
	} else {
		const { data, error } = await db.schema("catalogue").from("products")
			.select(PRODUCT_COLUMNS).eq("slug", itemId).maybeSingle();
		if (error) fail("catalogue.products", error.message);
		product = data as ProductRow | null;
	}
	const subjectId = blueprint?.id ?? product?.id;
	if (!subjectId) return null;

	let listingQuery = db.schema("catalogue").from("listings")
		.select(LISTING_COLUMNS)
		.eq(kind === "service" ? "service_blueprint_id" : "product_id", subjectId);
	if (!asOwner) listingQuery = listingQuery.eq("status", "published");
	const { data: listingData, error: listingError } = await listingQuery.limit(1);
	if (listingError) fail("catalogue.listings", listingError.message);
	const listing = ((listingData ?? []) as ListingRow[])[0];
	if (!listing) return null;
	if (asOwner && (listing.status === "archived" || !asOwner.owns(listing))) return null;

	const [media, listingSkills, listingTags, skillsRes] = await Promise.all([
		byIds<ListingMediaRow>(db, "catalogue", "listing_media", LISTING_MEDIA_COLUMNS, "listing_id", [
			listing.id,
		]),
		byIds<{ listing_id: string; skill_id: string }>(
			db,
			"catalogue",
			"listing_skills",
			"listing_id, skill_id",
			"listing_id",
			[listing.id],
		),
		byIds<ListingTagRow>(db, "catalogue", "listing_tags", "listing_id, tag", "listing_id", [
			listing.id,
		]),
		db.schema("org").from("skills").select("id, slug, label"),
	]);
	if (skillsRes.error) fail("org.skills", skillsRes.error.message);
	const mediaRefs = await fetchPublicMedia(db, listingMediaFileIds(media));

	const single = assemble({
		profiles: [...catalog.profileById.values()],
		listings: [listing],
		blueprints: blueprint ? [blueprint] : [],
		products: product ? [product] : [],
		articles: [],
		projects: [],
		stages: [],
		roles: [],
		seats: [],
		media,
		mediaRefs,
		files: [],
		listingSkills,
		listingTags,
		requiredSkills: [],
		skillRows: (skillsRes.data ?? []) as Array<{ id: string; slug: string; label: string }>,
		placements: [],
	});
	const item = single.byId.get(itemId);
	if (!item) return null;

	const entity: CatalogEntity = blueprint
		? { kind: "service_blueprint", id: blueprint.id }
		: { kind: "product", id: product!.id };
	return {
		...catalog,
		byId: new Map(catalog.byId).set(item.id, item),
		entityById: new Map(catalog.entityById).set(item.id, entity),
		blueprintBySlug: blueprint
			? new Map(catalog.blueprintBySlug).set(item.id, blueprint)
			: catalog.blueprintBySlug,
		productBySlug: product
			? new Map(catalog.productBySlug).set(item.id, product)
			: catalog.productBySlug,
		galleryById: new Map(catalog.galleryById).set(item.id, single.galleryById.get(item.id) ?? []),
		listingIdById: new Map(catalog.listingIdById).set(item.id, listing.id),
		listingTermsById: new Map(catalog.listingTermsById).set(
			item.id,
			single.listingTermsById.get(item.id) ?? { tags: [], seoDescription: "" },
		),
	};
}

// #endregion

// #region Mapping

/** A numeric column PostgREST may return as a string (`numeric` is serialised as text). */
function num(value: number | string | null | undefined): number {
	const n = typeof value === "string" ? Number(value) : value ?? 0;
	return Number.isFinite(n) ? n : 0;
}

/**
 * Minor units → major units for the corpus's major-unit numeric fields (`ticketPrice`, …), through the
 * currency's own exponent — a JPY listing's `5000` is ¥5,000, not ¥50.
 */
function major(cents: number | null | undefined, currency: string): number | undefined {
	return cents === null || cents === undefined
		? undefined
		: toMajorUnits(cents, currency) ?? undefined;
}

/** The placeholder a stored image's metadata carries, when extraction recorded one. */
export function placeholderOf(file: FileRow | undefined): ImagePlaceholder | undefined {
	const media = file?.metadata && typeof file.metadata === "object"
		? (file.metadata as { media?: { blurhash?: unknown; colors?: unknown } }).media
		: undefined;
	const blurhash = typeof media?.blurhash === "string" ? media.blurhash : undefined;
	return blurhash ? { blurhash } : undefined;
}

/** The measured pixel dimensions a stored image's metadata carries. */
export function dimensionsOf(file: FileRow | undefined): { width: number; height: number } | null {
	const media = file?.metadata && typeof file.metadata === "object"
		? (file.metadata as { media?: { width?: unknown; height?: unknown } }).media
		: undefined;
	const width = typeof media?.width === "number" ? media.width : 0;
	const height = typeof media?.height === "number" ? media.height : 0;
	return width > 0 && height > 0 ? { width, height } : null;
}

const SERVICE_TYPE: Record<BlueprintRow["delivery_model"], ServiceType> = {
	pipeline: "Pipeline",
	one_off: "One-Off",
	direct_deliverable: "Direct Deliverable",
	session: "Session",
	group_session: "Group Session",
};

/** The profile types the discovery taxonomy files each directory row under. */
const PROFILE_TYPE: Record<ProfileRow["entity_type"], ProfileItem["type"]> = {
	user: "users",
	freelancer: "freelancers",
	team: "teams",
	business: "businesses",
};

/** Dual-track reputation from the directory's split ratings; a track with no reviews is absent. */
function dualRating(p: ProfileRow): DualRating | undefined {
	const helperCount = p.reviews_as_freelancer ?? 0;
	const clientCount = p.reviews_as_client ?? 0;
	const rating: DualRating = {};
	if (helperCount > 0) {
		rating.asHelper = { value: num(p.rating_as_freelancer), count: helperCount };
	}
	if (clientCount > 0) rating.asClient = { value: num(p.rating_as_client), count: clientCount };
	return rating.asHelper || rating.asClient ? rating : undefined;
}

/** A product's stored masonry weight, clamped to the three the card draws. */
function spanOf(span: number): 1 | 2 | 3 {
	return span >= 3 ? 3 : span <= 1 ? 1 : 2;
}

/** Workload band copy — the same thresholds the discovery card's meter uses. */
function workloadStatus(level: number): string {
	if (level >= 85) return "Busy";
	if (level >= 50) return "Moderate";
	return "Light";
}

/**
 * How much of a seller's Global Intensity Cap their active tickets use, 0–100 — the scale the card's
 * meter and the ranking's availability term both read. `undefined` for a buyer, who has no cap.
 */
function utilisationOf(p: ProfileRow): number | undefined {
	if (p.entity_type !== "freelancer" && p.entity_type !== "team") return undefined;
	const cap = num(p.workload_cap);
	return cap > 0 ? workloadPercent(p.workload, cap) : undefined;
}

/** The discovery-signal kind a directory row is viewed and saved as. */
const PROFILE_ENTITY: Record<ProfileRow["entity_type"], DiscoveryEntityKind> = {
	user: "user",
	freelancer: "freelancer",
	team: "team",
	business: "business",
};

const DAY_MS = 86_400_000;

/** The raw reads {@link assemble} maps — exported so a test can build a catalogue from rows. */
export type CatalogInputs = Inputs;

interface Inputs {
	profiles: ProfileRow[];
	listings: ListingRow[];
	blueprints: BlueprintRow[];
	products: ProductRow[];
	articles: ArticleRow[];
	projects: ProjectRow[];
	stages: StageRow[];
	roles: StaffingRoleRow[];
	seats: OpenSeatRow[];
	media: ListingMediaRow[];
	/** `files.get_public_media` for the media rows' files; absent = no listing picture is public. */
	mediaRefs?: ReadonlyMap<string, MediaRef>;
	/** Article cover files. */
	files: FileRow[];
	listingSkills: Array<{ listing_id: string; skill_id: string }>;
	/** Search tags; absent = no listing has any. */
	listingTags?: ListingTagRow[];
	requiredSkills: Array<{ project_id: string; skill_id: string }>;
	skillRows: Array<{ id: string; slug: string; label: string }>;
	placements: PlacementRow[];
	/** Penalised entities; absent = nobody is penalised. */
	penalties?: PenaltyRow[];
	/** `search.ranking_weights()`; absent = every factor off, so every item scores 0. */
	weights?: RankingWeightRow[];
	/** `search.trending_entities()`, most active first; absent = no activity. */
	trending?: TrendingEntityRow[];
}

/** Assemble the mapped catalogue from the raw reads. Pure — every read has already happened. */
export function assemble(input: Inputs): Catalog {
	const skillLabelById = new Map(input.skillRows.map((s) => [s.id, s.label]));
	const skillLabelBySlug = new Map(input.skillRows.map((s) => [s.slug, s.label]));
	const fileById = new Map(input.files.map((f) => [f.id, f]));
	const profileById = new Map(input.profiles.map((p) => [p.entity_id, p]));
	const blueprintById = new Map(input.blueprints.map((b) => [b.id, b]));
	const productById = new Map(input.products.map((p) => [p.id, p]));
	const sponsoredSubjects = new Set(input.placements.map((p) => p.entity_id));

	const urlOf = (file: FileRow | undefined) =>
		file ? publicObjectUrl(file.bucket_id, file.storage_path) ?? "" : "";

	/** The owner a row credits: its team when team-owned, else the accountable person. */
	const ownerOf = (userId: string, teamId: string | null): ExploreOwner | null => {
		const row = profileById.get(teamId ?? userId);
		if (!row) return null;
		return {
			handle: `@${row.handle}`,
			name: row.name,
			avatar: publicObjectUrl(row.avatar_bucket, row.avatar_path) ?? "",
			kind: row.entity_type,
			verified: row.verified,
			verificationStamp: stampOf(row.verification_stamp),
		};
	};

	const galleryById = new Map<string, CatalogMedia[]>();
	const listingIdById = new Map<string, string>();
	const listingTermsById = new Map<string, ListingSearchTerms>();
	const tagsByListing = new Map<string, string[]>();
	for (const t of input.listingTags ?? []) {
		const list = tagsByListing.get(t.listing_id) ?? [];
		list.push(t.tag);
		tagsByListing.set(t.listing_id, list);
	}
	const termsOf = (l: ListingRow): ListingSearchTerms => ({
		tags: tagsByListing.get(l.id) ?? [],
		seoDescription: l.seo_description ?? "",
	});
	const mediaByListing = mediaRowsByListing(input.media);
	const mediaRefs = input.mediaRefs ?? new Map<string, MediaRef>();

	const skillsByListing = new Map<string, SkillRef[]>();
	for (const ls of input.listingSkills) {
		const label = skillLabelById.get(ls.skill_id);
		if (!label) continue;
		const list = skillsByListing.get(ls.listing_id) ?? [];
		list.push(resolveSkill(label));
		skillsByListing.set(ls.listing_id, list);
	}

	// #region Services + products (listings)
	const services: ServiceItem[] = [];
	const products: ProductItem[] = [];
	const blueprintBySlug = new Map<string, BlueprintRow>();
	const productBySlug = new Map<string, ProductRow>();
	const servicePricesByOwner = new Map<string, number[]>();
	const serviceCurrenciesByOwner = new Map<string, Set<string>>();
	const productCountByOwner = new Map<string, number>();
	const highlightsByOwner = new Map<string, string[]>();
	const highlight = (ownerKey: string, src: string | undefined) => {
		if (!src) return;
		const list = highlightsByOwner.get(ownerKey) ?? [];
		if (list.length < 3) list.push(src);
		highlightsByOwner.set(ownerKey, list);
	};

	for (const l of input.listings) {
		const owner = ownerOf(l.owner_user_id, l.owner_team_id);
		if (!owner) continue;
		const slots = listingMediaSlots(mediaByListing.get(l.id) ?? [], mediaRefs);
		const gallery: CatalogMedia[] = slots.map((s) => ({
			src: s.src,
			thumb: s.thumb,
			kind: s.kind,
			alt: s.alt,
			placeholder: s.placeholder,
			width: s.width ?? null,
			height: s.height ?? null,
		}));
		const source = {
			owner,
			skills: skillsByListing.get(l.id) ?? [],
			descriptionText: l.description_text,
			media: slots,
			delivery: l.delivery_label,
			updatedAt: l.updated_at,
			listedAt: l.published_at ?? l.created_at,
		};
		const ownerKey = owner.handle;

		if (l.kind === "service" && l.service_blueprint_id) {
			const bp = blueprintById.get(l.service_blueprint_id);
			if (!bp) continue;
			const serviceType = SERVICE_TYPE[bp.delivery_model];
			const item = listingCardItem(
				{
					...source,
					id: bp.slug,
					kind: "service",
					serviceType,
					title: l.title,
					category: l.category,
					currency: l.currency,
					pricing: {
						amount: major(l.amount_cents, l.currency) ?? 0,
						ticketPrice: major(bp.ticket_price_cents ?? l.ticket_price_cents, l.currency) ?? null,
						sessionPrice: major(bp.session_price_cents ?? l.session_price_cents, l.currency) ??
							null,
						freeRevisions: bp.free_revisions ?? l.free_revisions,
						extraRevisionPrice:
							major(bp.extra_revision_price_cents ?? l.extra_revision_price_cents, l.currency) ??
								null,
					},
					metrics: { avgRating: num(bp.rating_average), ratingCount: bp.rating_count ?? 0 },
					promoted: l.promoted && sponsoredSubjects.has(bp.id),
				} satisfies ListingCardSource,
			);
			if (item.type !== "services") continue;
			highlight(ownerKey, item.media);
			services.push(item);
			blueprintBySlug.set(item.id, bp);
			galleryById.set(item.id, gallery);
			listingIdById.set(item.id, l.id);
			listingTermsById.set(item.id, termsOf(l));
			const unit = serviceType === "Pipeline"
				? item.ticketPrice
				: serviceType === "Session" || serviceType === "Group Session"
				? item.sessionPrice
				: major(l.amount_cents, l.currency);
			if (unit !== undefined) {
				const list = servicePricesByOwner.get(ownerKey) ?? [];
				list.push(unit);
				servicePricesByOwner.set(ownerKey, list);
				const currencies = serviceCurrenciesByOwner.get(ownerKey) ?? new Set<string>();
				currencies.add(l.currency.toUpperCase());
				serviceCurrenciesByOwner.set(ownerKey, currencies);
			}
		} else if (l.kind === "product" && l.product_id) {
			const pr = productById.get(l.product_id);
			if (!pr) continue;
			const item = listingCardItem(
				{
					...source,
					id: pr.slug,
					kind: "product",
					serviceType: null,
					title: l.title,
					category: pr.category,
					currency: pr.currency,
					pricing: {
						amount: major(pr.price_cents, pr.currency) ?? 0,
						ticketPrice: null,
						sessionPrice: null,
						freeRevisions: null,
						extraRevisionPrice: null,
					},
					metrics: { avgRating: num(pr.rating_average), ratingCount: pr.rating_count ?? 0 },
					promoted: l.promoted && sponsoredSubjects.has(pr.id),
					span: spanOf(pr.span),
				} satisfies ListingCardSource,
			);
			if (item.type !== "products") continue;
			highlight(ownerKey, item.media);
			products.push(item);
			productBySlug.set(item.id, pr);
			galleryById.set(item.id, gallery);
			listingIdById.set(item.id, l.id);
			listingTermsById.set(item.id, termsOf(l));
			productCountByOwner.set(ownerKey, (productCountByOwner.get(ownerKey) ?? 0) + 1);
		}
	}
	// #endregion

	// #region Articles
	const articles: ArticleItem[] = [];
	const articleBySlug = new Map<string, ArticleRow>();
	for (const a of input.articles) {
		const owner = ownerOf(a.owner_user_id, a.owner_team_id);
		if (!owner) continue;
		const coverFile = a.cover_file_id ? fileById.get(a.cover_file_id) : undefined;
		const cover = urlOf(coverFile);
		const item: ArticleItem = {
			id: a.slug,
			type: "articles",
			title: a.title,
			owner,
			skills: a.topic ? [resolveSkill(a.topic)] : [],
			summary: a.summary,
			media: cover || undefined,
			mediaPlaceholder: placeholderOf(coverFile),
			createdAt: a.published_at ?? a.created_at,
			topic: a.topic,
			readMinutes: a.read_minutes,
		};
		articles.push(item);
		articleBySlug.set(item.id, a);
		if (cover) {
			const dims = dimensionsOf(coverFile);
			galleryById.set(item.id, [{
				src: cover,
				thumb: cover,
				kind: "image",
				alt: a.title,
				placeholder: placeholderOf(coverFile),
				width: dims?.width ?? null,
				height: dims?.height ?? null,
			}]);
		}
	}
	// #endregion

	// #region Projects
	const projectItems: ProjectItem[] = [];
	const projectBySlug: Catalog["projectBySlug"] = new Map();
	const stagesByProject = new Map<string, StageRow[]>();
	for (const s of input.stages) {
		const list = stagesByProject.get(s.project_id) ?? [];
		list.push(s);
		stagesByProject.set(s.project_id, list);
	}
	const rolesByStage = new Map<string, StaffingRoleRow[]>();
	for (const r of input.roles) {
		const list = rolesByStage.get(r.project_stage_id) ?? [];
		list.push(r);
		rolesByStage.set(r.project_stage_id, list);
	}
	const seatsByStage = new Map<string, OpenSeatRow[]>();
	for (const s of input.seats) {
		const list = seatsByStage.get(s.project_stage_id) ?? [];
		list.push(s);
		seatsByStage.set(s.project_stage_id, list);
	}
	const skillsByProject = new Map<string, string[]>();
	for (const rs of input.requiredSkills) {
		const label = skillLabelById.get(rs.skill_id);
		if (!label) continue;
		const list = skillsByProject.get(rs.project_id) ?? [];
		list.push(label);
		skillsByProject.set(rs.project_id, list);
	}
	for (const p of input.projects) {
		const owner = ownerOf(p.owner_user_id, p.owner_team_id);
		if (!owner) continue;
		const client = p.client_business_id ? profileById.get(p.client_business_id) : undefined;
		const stages = (stagesByProject.get(p.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
		const stageRoles = stages.flatMap((s) => rolesByStage.get(s.id) ?? []);
		const stageSeats = stages.flatMap((s) => seatsByStage.get(s.id) ?? []);
		const current = stages.find((s) => s.status !== "completed" && s.status !== "cancelled") ??
			stages[stages.length - 1];
		const skillLabels = new Set<string>(skillsByProject.get(p.id) ?? []);
		for (const s of stages) {
			for (const slug of s.skills ?? []) skillLabels.add(skillLabelBySlug.get(slug) ?? slug);
		}
		const item: ProjectItem = {
			id: p.slug,
			type: "projects",
			title: p.title,
			owner,
			skills: [...skillLabels].slice(0, 8).map(resolveSkill),
			summary: p.description_text,
			createdAt: p.created_at,
			org: client?.name ?? owner.name,
			stage: current?.name ?? "",
			budget: p.budget_amount_cents !== null && p.budget_amount_cents !== undefined
				? displayPrice(p.budget_amount_cents, p.currency)
				: "",
			budgetMinor: p.budget_amount_cents ?? undefined,
			currency: p.currency.toUpperCase(),
			classification: p.format === "pipeline" ? "pipeline" : "one-off",
			roles: [...new Set(stageRoles.map((r) => r.role_title))],
			phases: stages.map((s) => s.name),
			cover: (() => {
				const framer = client ?? profileById.get(p.owner_team_id ?? p.owner_user_id);
				return framer
					? publicObjectUrl(framer.banner_bucket, framer.banner_path) ?? undefined
					: undefined;
			})(),
		};
		projectItems.push(item);
		projectBySlug.set(item.id, { row: p, stages, roles: stageRoles, seats: stageSeats });
	}
	// #endregion

	// #region Profiles
	const profileItems: ProfileItem[] = [];
	const profileByHandle = new Map<string, ProfileRow>();
	for (const p of input.profiles) {
		profileByHandle.set(`@${p.handle}`, p);
		if (!p.listed) continue;
		const handle = `@${p.handle}`;
		const type = PROFILE_TYPE[p.entity_type];
		const delivered = p.delivered_count ?? 0;
		const location = [p.city, p.location].filter((x): x is string => !!x && x.length > 0).join(
			", ",
		);
		const skills = (p.skills ?? []).map((slug) => resolveSkill(skillLabelBySlug.get(slug) ?? slug));
		const seller = p.entity_type === "freelancer" || p.entity_type === "team";
		const prices = servicePricesByOwner.get(handle) ?? [];
		const priceCurrencies = serviceCurrenciesByOwner.get(handle);
		const load = utilisationOf(p) ?? 0;
		const item: ProfileItem = {
			id: p.handle,
			type,
			title: p.name,
			owner: {
				handle,
				name: p.name,
				avatar: publicObjectUrl(p.avatar_bucket, p.avatar_path) ?? "",
				kind: p.entity_type,
				verified: p.verified,
				verificationStamp: stampOf(p.verification_stamp),
			},
			skills,
			rating: dualRating(p),
			summary: p.headline ?? "",
			craft: p.headline ?? "",
			cover: publicObjectUrl(p.showcase_bucket, p.showcase_path) ??
				publicObjectUrl(p.banner_bucket, p.banner_path) ?? "",
			delivered,
			members: p.entity_type === "team" || p.entity_type === "business"
				? p.member_count ?? 0
				: undefined,
			location: location || undefined,
			languages: p.language_codes ?? [],
			highlights: seller ? highlightsByOwner.get(handle) : undefined,
			servicePrices: p.entity_type === "freelancer" && prices.length ? prices : undefined,
			serviceCurrency: p.entity_type === "freelancer" && priceCurrencies?.size === 1
				? [...priceCurrencies][0]
				: undefined,
			products: p.entity_type === "freelancer" ? productCountByOwner.get(handle) ?? 0 : undefined,
			workload: p.entity_type === "freelancer"
				? { level: load, status: workloadStatus(load) }
				: undefined,
			createdAt: p.joined_at,
		};
		profileItems.push(item);
	}
	// #endregion

	const itemIdBySubject = new Map<string, string>();
	for (const [itemId, bp] of blueprintBySlug) itemIdBySubject.set(bp.id, itemId);
	for (const [itemId, pr] of productBySlug) itemIdBySubject.set(pr.id, itemId);
	const placements: CatalogPlacement[] = input.placements.flatMap((p) => {
		const itemId = itemIdBySubject.get(p.entity_id);
		return itemId ? [{ surface: p.surface, itemId }] : [];
	});

	const unranked: ExploreItem[] = [
		...profileItems,
		...services,
		...projectItems,
		...products,
		...articles,
	];

	// #region Discovery entities + ranking
	const entityById = new Map<string, CatalogEntity>();
	for (const [itemId, bp] of blueprintBySlug) {
		entityById.set(itemId, { kind: "service_blueprint", id: bp.id });
	}
	for (const [itemId, pr] of productBySlug) entityById.set(itemId, { kind: "product", id: pr.id });
	for (const [itemId, a] of articleBySlug) entityById.set(itemId, { kind: "article", id: a.id });
	for (const [itemId, p] of projectBySlug) {
		entityById.set(itemId, { kind: "project", id: p.row.id });
	}
	for (const it of profileItems) {
		const row = profileByHandle.get(`@${it.id}`);
		if (row) entityById.set(it.id, { kind: PROFILE_ENTITY[row.entity_type], id: row.entity_id });
	}
	const itemIdByEntity = new Map(
		[...entityById].map(([itemId, e]) => [entityKey(e.kind, e.id), itemId]),
	);

	const { weights } = resolveWeights(input.weights ?? []);
	const scoreById = scoreCatalog(unranked, {
		profileByHandle,
		profileById,
		projectBySlug,
		penalties: input.penalties ?? [],
		weights,
		now: Date.now(),
	});
	const items = [...unranked].sort(byScore(scoreById));
	const trending = (input.trending ?? []).flatMap((t) => {
		const itemId = itemIdByEntity.get(entityKey(t.entity_type, t.entity_id));
		return itemId ? [itemId] : [];
	});
	// #endregion

	return {
		items,
		scoreById,
		weights,
		entityById,
		itemIdByEntity,
		trending,
		byId: new Map(items.map((it) => [it.id, it])),
		blueprintBySlug,
		productBySlug,
		articleBySlug,
		projectBySlug,
		galleryById,
		listingIdById,
		listingTermsById,
		profileByHandle,
		profileById,
		sponsoredSubjects,
		placements,
		loadedAt: Date.now(),
	};
}

/** Which reputation track speaks for an item: a seller's delivery reviews, or a buyer's client reviews. */
type Track = "helper" | "client";

const CLIENT_TRACK = new Set<ExploreItem["type"]>(["users", "businesses", "projects"]);
const AVAILABILITY_TYPES = new Set<ExploreItem["type"]>(["freelancers", "teams", "services"]);
const STANDING_TYPES = new Set<ExploreItem["type"]>([
	"freelancers",
	"teams",
	"services",
	"products",
]);

/**
 * Score every item (`./ranking.ts`) from its own reviews and its owner's directory row: the seller's
 * workload against their cap, Standing rung and multiplier, tenure, and active discovery-rank
 * penalty. A project speaks with its CLIENT's reviews and carries the worse of its poster's and its
 * client business's penalty — "their project posts are de-ranked" (§Reputation & Discovery 3).
 */
function scoreCatalog(
	items: readonly ExploreItem[],
	context: {
		profileByHandle: Map<string, ProfileRow>;
		profileById: Map<string, ProfileRow>;
		projectBySlug: Catalog["projectBySlug"];
		penalties: readonly PenaltyRow[];
		weights: RankingWeights;
		now: number;
	},
): Map<string, number> {
	const penaltyById = new Map<string, number>();
	for (const p of context.penalties) {
		const severity = num(p.discovery_penalty);
		penaltyById.set(p.entity_id, Math.max(penaltyById.get(p.entity_id) ?? 0, severity));
	}
	const penaltyOf = (row: ProfileRow | undefined): number =>
		row ? penaltyById.get(row.entity_id) ?? 0 : 0;
	const clientTrack = (row: ProfileRow | undefined) =>
		row && (row.reviews_as_client ?? 0) > 0
			? { value: num(row.rating_as_client), count: row.reviews_as_client ?? 0 }
			: undefined;

	const signals = items.map((item): { item: ExploreItem; track: Track; signals: RankSignals } => {
		const owner = context.profileByHandle.get(item.owner.handle);
		const project = item.type === "projects" ? context.projectBySlug.get(item.id) : undefined;
		const clientId = project?.row.client_business_id;
		const client = clientId ? context.profileById.get(clientId) : owner;
		const joined = owner ? Date.parse(owner.joined_at) : Number.NaN;
		const track: Track = CLIENT_TRACK.has(item.type) ? "client" : "helper";
		const seller = STANDING_TYPES.has(item.type);
		return {
			item,
			track,
			signals: {
				rating: item.type === "projects"
					? clientTrack(client)
					: track === "client"
					? item.rating?.asClient
					: item.rating?.asHelper,
				utilisation: AVAILABILITY_TYPES.has(item.type) && owner ? utilisationOf(owner) : undefined,
				standingLevel: seller ? owner?.standing_level ?? undefined : undefined,
				standingWeightBp: seller ? owner?.discovery_weight_bp ?? undefined : undefined,
				penalty: Math.max(penaltyOf(owner), item.type === "projects" ? penaltyOf(client) : 0),
				tenureDays: Number.isFinite(joined)
					? Math.max(0, Math.floor((context.now - joined) / DAY_MS))
					: Number.POSITIVE_INFINITY,
			},
		};
	});

	const weights = context.weights;
	const prior = {
		helper: priorMeanOf(signals.filter((s) => s.track === "helper").map((s) => s.signals.rating)),
		client: priorMeanOf(signals.filter((s) => s.track === "client").map((s) => s.signals.rating)),
	};
	return new Map(
		signals.map((s) => [
			s.item.id,
			scoreItem(s.signals, { weights, priorMean: prior[s.track] }).total,
		]),
	);
}

// #endregion
