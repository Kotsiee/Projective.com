import type { SupabaseClient } from "supabaseClient";
import { getAnonClient } from "../../core/supabase.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { resolveSkill } from "./skills.ts";
import type {
	ArticleItem,
	DualRating,
	ExploreItem,
	ExploreOwner,
	ProductItem,
	ProfileItem,
	ProjectItem,
	ServiceItem,
	ServiceType,
	SkillRef,
} from "@projective/types/explore";
import type { ImagePlaceholder } from "@projective/types/files";

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
	published_at: string | null;
	created_at: string;
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
}

/** A named staffing role on a public project's stage. */
export interface StaffingRoleRow {
	id: string;
	project_stage_id: string;
	role_title: string;
	quantity: number | null;
	budget_amount_cents: number | null;
	skills: string[] | null;
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

interface MediaRow {
	listing_id: string;
	file_id: string | null;
	url: string | null;
	alt_text: string;
	position: number;
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
}

// #endregion

// #region The loaded catalogue

/** One gallery frame of a listing, resolved to a URL. */
export interface CatalogMedia {
	src: string;
	alt: string;
	placeholder?: ImagePlaceholder;
	width: number | null;
	height: number | null;
}

/** Everything a discovery surface reads, loaded once and shared. */
export interface Catalog {
	/** Every discoverable item, in a stable order (the query layer ranks it). */
	items: ExploreItem[];
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
	/** Owner `@handle` → the profile row (for seller facts on the view page). */
	profileByHandle: Map<string, ProfileRow>;
	/** Entity id (user / team / business uuid) → the profile row (review authors, project clients). */
	profileById: Map<string, ProfileRow>;
	/** The subject ids (blueprint / product uuid) of every active paid placement. */
	sponsoredSubjects: Set<string>;
	/** When this load completed. */
	loadedAt: number;
}

/** How long one load serves every request. Short: a seller's publish should appear quickly. */
export const CATALOG_TTL_MS = 30_000;

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
 * Install a catalogue as the latest snapshot WITHOUT reading the database — for unit tests of the
 * synchronous resolvers (`findItem`, `composeLoadedViewPage`) and nothing else. Build one from rows
 * with {@link assemble}. `null` clears it. The next awaited {@link loadCatalog} still reads the
 * database: this only changes what {@link peekCatalog} answers.
 */
export function primeCatalogForTesting(catalog: Catalog | null): void {
	latest = catalog;
	cached = null;
}

// #endregion

// #region Reads

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

	const [profilesRes, listingsRes, articlesRes, projectsRes, placementsRes, skillsRes] =
		await Promise
			.all([
				db.schema("org").from("profiles_index").select(
					"entity_id, entity_type, handle, name, headline, languages, location, city, rating_as_client, reviews_as_client, rating_as_freelancer, reviews_as_freelancer, active_project_count, total_project_count, member_count, listed, avatar_bucket, avatar_path, banner_bucket, banner_path, verified, skills, workload, joined_at, verification_tier, language_codes, delivered_count, showcase_bucket, showcase_path, standing_level, standing_label",
				),
				db.schema("catalogue").from("listings").select(
					"id, owner_user_id, owner_team_id, kind, service_blueprint_id, product_id, title, description_text, category, delivery_label, amount_cents, currency, ticket_price_cents, session_price_cents, seats_per_session, free_revisions, extra_revision_price_cents, promoted, published_at, created_at",
				).eq("status", "published"),
				db.schema("catalogue").from("articles").select(
					"id, slug, owner_user_id, owner_team_id, title, topic, summary, body, cover_file_id, read_minutes, published_at, created_at",
				).eq("status", "published"),
				db.schema("projects").from("projects").select(
					"id, slug, owner_user_id, owner_team_id, client_business_id, title, description_text, format, structure_variation, currency, budget_type, budget_amount_cents, created_at",
				).eq("status", "active").eq("visibility", "public"),
				db.schema("marketplace").from("promoted_placements").select("entity_type, entity_id"),
				db.schema("org").from("skills").select("id, slug, label"),
			]);
	if (profilesRes.error) fail("org.profiles_index", profilesRes.error.message);
	if (listingsRes.error) fail("catalogue.listings", listingsRes.error.message);
	if (articlesRes.error) fail("catalogue.articles", articlesRes.error.message);
	if (projectsRes.error) fail("projects.projects", projectsRes.error.message);
	if (placementsRes.error) fail("marketplace.promoted_placements", placementsRes.error.message);
	if (skillsRes.error) fail("org.skills", skillsRes.error.message);

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

	const [blueprints, products, media, listingSkills, stages, requiredSkills] = await Promise.all([
		byIds<BlueprintRow>(
			db,
			"marketplace",
			"service_blueprints",
			"id, slug, owner_type, owner_team_id, freelancer_profile_id, delivery_model, price_cents, ticket_price_cents, session_price_cents, currency, free_revisions, extra_revision_price_cents, max_seats_per_cohort, intake_fields, stage_template, team_roles, deliverables, session_minutes, session_count, rating_average, rating_count",
			"id",
			blueprintIds,
		),
		byIds<ProductRow>(
			db,
			"catalogue",
			"products",
			"id, slug, owner_user_id, owner_team_id, format, category, price_cents, currency, licence, attribution_required, file_manifest, compatibility, specs, span, rating_average, rating_count",
			"id",
			productIds,
		),
		byIds<MediaRow>(
			db,
			"catalogue",
			"listing_media",
			"listing_id, file_id, url, alt_text, position",
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
			"id, project_id, name, slug, description_text, sort_order, status, skills, unit_price_cents, seat_count, seat_limit, parallel",
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
	]);

	const stageIds = stages.map((s) => s.id);
	const fileIds = [
		...media.map((m) => m.file_id).filter((x): x is string => !!x),
		...articles.map((a) => a.cover_file_id).filter((x): x is string => !!x),
	];
	const [roles, seats, files] = await Promise.all([
		byIds<StaffingRoleRow>(
			db,
			"projects",
			"stage_staffing_roles",
			"id, project_stage_id, role_title, quantity, budget_amount_cents, skills",
			"project_stage_id",
			stageIds,
		),
		byIds<OpenSeatRow>(
			db,
			"projects",
			"stage_open_seats",
			"id, project_stage_id, description_of_need, budget_min_cents, budget_max_cents, status",
			"project_stage_id",
			stageIds,
		),
		byIds<FileRow>(db, "files", "items", "id, bucket_id, storage_path, metadata", "id", fileIds),
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
		files,
		listingSkills,
		requiredSkills,
		skillRows,
		placements,
	});
}

// #endregion

// #region Mapping

/** A numeric column PostgREST may return as a string (`numeric` is serialised as text). */
function num(value: number | string | null | undefined): number {
	const n = typeof value === "string" ? Number(value) : value ?? 0;
	return Number.isFinite(n) ? n : 0;
}

/** Minor units → major units for the corpus's major-unit numeric fields (`ticketPrice`, …). */
function major(cents: number | null | undefined): number | undefined {
	return cents === null || cents === undefined ? undefined : cents / 100;
}

/**
 * A money figure as the legacy display string (`$4,800`, `$99.50`). Whole amounts drop the decimals —
 * the way every price in the corpus has always read — and fractional ones keep them. Presentation for
 * surfaces not yet on `MoneyView`; the structured `priceMinor` + `currency` travel beside it.
 */
export function displayPrice(cents: number, currency: string): string {
	const whole = cents % 100 === 0;
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
			minimumFractionDigits: whole ? 0 : 2,
			maximumFractionDigits: whole ? 0 : 2,
		}).format(cents / 100);
	} catch {
		return `${(cents / 100).toFixed(whole ? 0 : 2)} ${currency}`;
	}
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

/** A helper-track rating from a subject's own denormalised average (blueprint / product). */
function helperRating(avg: number | string | null, count: number | null): DualRating | undefined {
	return (count ?? 0) > 0 ? { asHelper: { value: num(avg), count: count ?? 0 } } : undefined;
}

/** Workload band copy — the same thresholds the discovery card's meter uses. */
function workloadStatus(level: number): string {
	if (level >= 85) return "Busy";
	if (level >= 50) return "Moderate";
	return "Light";
}

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
	media: MediaRow[];
	files: FileRow[];
	listingSkills: Array<{ listing_id: string; skill_id: string }>;
	requiredSkills: Array<{ project_id: string; skill_id: string }>;
	skillRows: Array<{ id: string; slug: string; label: string }>;
	placements: PlacementRow[];
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
		};
	};

	const galleryById = new Map<string, CatalogMedia[]>();
	const listingIdById = new Map<string, string>();
	const mediaByListing = new Map<string, MediaRow[]>();
	for (const m of input.media) {
		const list = mediaByListing.get(m.listing_id) ?? [];
		list.push(m);
		mediaByListing.set(m.listing_id, list);
	}
	const galleryOf = (listingId: string): CatalogMedia[] =>
		(mediaByListing.get(listingId) ?? [])
			.sort((a, b) => a.position - b.position)
			.flatMap((m) => {
				const file = m.file_id ? fileById.get(m.file_id) : undefined;
				const src = file ? urlOf(file) : m.url ?? "";
				if (!src) return [];
				const dims = dimensionsOf(file);
				return [{
					src,
					alt: m.alt_text,
					placeholder: placeholderOf(file),
					width: dims?.width ?? null,
					height: dims?.height ?? null,
				}];
			});

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
	const productCountByOwner = new Map<string, number>();
	const highlightsByOwner = new Map<string, string[]>();

	for (const l of input.listings) {
		const owner = ownerOf(l.owner_user_id, l.owner_team_id);
		if (!owner) continue;
		const gallery = galleryOf(l.id);
		const cover = gallery[0];
		const common = {
			title: l.title,
			owner,
			skills: skillsByListing.get(l.id) ?? [],
			summary: l.description_text,
			media: cover?.src,
			mediaPlaceholder: cover?.placeholder,
			createdAt: l.published_at ?? l.created_at,
		};
		const ownerKey = owner.handle;
		if (cover) {
			const list = highlightsByOwner.get(ownerKey) ?? [];
			if (list.length < 3) list.push(cover.src);
			highlightsByOwner.set(ownerKey, list);
		}

		if (l.kind === "service" && l.service_blueprint_id) {
			const bp = blueprintById.get(l.service_blueprint_id);
			if (!bp) continue;
			const serviceType = SERVICE_TYPE[bp.delivery_model];
			const item: ServiceItem = {
				...common,
				id: bp.slug,
				type: "services",
				price: displayPrice(l.amount_cents, l.currency),
				delivery: l.delivery_label,
				category: l.category,
				serviceType,
				ticketPrice: major(bp.ticket_price_cents ?? l.ticket_price_cents),
				sessionPrice: major(bp.session_price_cents ?? l.session_price_cents),
				freeRevisions: bp.free_revisions ?? l.free_revisions ?? undefined,
				extraRevisionPrice: major(bp.extra_revision_price_cents ?? l.extra_revision_price_cents),
				priceMinor: l.amount_cents,
				currency: l.currency,
				rating: helperRating(bp.rating_average, bp.rating_count),
				sponsored: l.promoted && sponsoredSubjects.has(bp.id),
			};
			services.push(item);
			blueprintBySlug.set(item.id, bp);
			galleryById.set(item.id, gallery);
			listingIdById.set(item.id, l.id);
			const unit = serviceType === "Pipeline"
				? item.ticketPrice
				: serviceType === "Session" || serviceType === "Group Session"
				? item.sessionPrice
				: l.amount_cents / 100;
			if (unit !== undefined) {
				const list = servicePricesByOwner.get(ownerKey) ?? [];
				list.push(unit);
				servicePricesByOwner.set(ownerKey, list);
			}
		} else if (l.kind === "product" && l.product_id) {
			const pr = productById.get(l.product_id);
			if (!pr) continue;
			const dims = cover ? { width: cover.width, height: cover.height } : null;
			const item: ProductItem = {
				...common,
				id: pr.slug,
				type: "products",
				price: displayPrice(pr.price_cents, pr.currency),
				category: pr.category,
				span: Math.min(3, Math.max(1, pr.span)) as 1 | 2 | 3,
				mediaMeta: dims?.width && dims.height
					? {
						width: dims.width,
						height: dims.height,
						aspectRatio: Math.round((dims.width / dims.height) * 10_000) / 10_000,
					}
					: undefined,
				priceMinor: pr.price_cents,
				currency: pr.currency,
				rating: helperRating(pr.rating_average, pr.rating_count),
				sponsored: l.promoted && sponsoredSubjects.has(pr.id),
			};
			products.push(item);
			productBySlug.set(item.id, pr);
			galleryById.set(item.id, gallery);
			listingIdById.set(item.id, l.id);
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
			products: p.entity_type === "freelancer" ? productCountByOwner.get(handle) ?? 0 : undefined,
			workload: p.entity_type === "freelancer"
				? { level: p.workload ?? 0, status: workloadStatus(p.workload ?? 0) }
				: undefined,
			createdAt: p.joined_at,
		};
		profileItems.push(item);
	}
	// #endregion

	const items: ExploreItem[] = [
		...profileItems,
		...services,
		...projectItems,
		...products,
		...articles,
	];
	return {
		items,
		byId: new Map(items.map((it) => [it.id, it])),
		blueprintBySlug,
		productBySlug,
		articleBySlug,
		projectBySlug,
		galleryById,
		listingIdById,
		profileByHandle,
		profileById,
		sponsoredSubjects,
		loadedAt: Date.now(),
	};
}

// #endregion
