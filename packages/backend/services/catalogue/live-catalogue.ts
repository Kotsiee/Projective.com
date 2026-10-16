import type { SupabaseClient } from "supabaseClient";
import {
	type AnalyticsPeriod,
	type CatalogueFacetCounts,
	type CatalogueListParams,
	type CataloguePage,
	type CatalogueStats,
	type CatalogueTypeFilter,
	coverOf,
	formArchetypeOf,
	type ListingAvailabilityBinding,
	type ListingDetail,
	type ListingMetrics,
	type ListingPricing,
	type ListingStatus,
	type ListingSummary,
	money,
	publishReadiness,
	resolveListingPricing,
	type ServiceType,
} from "@projective/types/catalogue";
import type { ExploreOwner, SkillRef } from "@projective/types/explore";
import type { MediaRef } from "@projective/types/files";
import { CreateCategory, VerificationStampSchema } from "@projective/types/org";
import { IntakeFieldSchema } from "@projective/types/services";
import { PLATFORM_BASE_CURRENCY, toMajorUnits } from "@projective/types/finance";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { publicObjectUrl } from "../../core/storage-url.ts";
import { resolveSkill } from "../explore/skills.ts";
import { fetchPublicMedia } from "../files/public-media.ts";
import { projectorFor } from "../finance/commerce-money.ts";
import { FxService } from "../finance/FxService.ts";
import type { ReadActor } from "../read-actor.ts";
import {
	LISTING_MEDIA_COLUMNS,
	listingMediaFileIds,
	type ListingMediaRow,
	listingMediaSlots,
	mediaRowsByListing,
} from "./listing-media.ts";
import {
	type OfferBlueprintColumns,
	offerFromBlueprint,
	offerFromProduct,
	type OfferProductColumns,
} from "./offer-columns.ts";
import { ownsListing } from "./ownership.ts";
import { liveHeadline } from "./live-catalogue-analytics.ts";

/**
 * live-catalogue — the seller console's READS, as the signed-in seller.
 *
 * Reads go through the seller's own client, so the catalogue policies decide what they see: their own
 * listings in every state, and nothing of anyone else's that is not published. Sales come from
 * `catalogue.get_listing_sales`, the one definer, which answers only for the caller's own listings.
 * The writes are `live-catalogue-writes.ts`.
 *
 * A listing's ADDRESS is its subject's slug — `svc-…` for a service, `prd-…` for a product — the same
 * one its public `/view/[id]` page answers to, so the console and the storefront name a listing the
 * same way. Every row is mapped by the pure {@link projectDetail}, the function the card-fidelity
 * contract holds against the explore assembler.
 */

// #region Rows
/** A `catalogue.listings` row as the console selects it. */
export interface CatalogueListingRow {
	id: string;
	owner_user_id: string;
	owner_team_id: string | null;
	kind: "product" | "service";
	status: ListingStatus;
	service_blueprint_id: string | null;
	product_id: string | null;
	title: string;
	description: { html?: string } | null;
	description_text: string;
	category: string;
	delivery_label: string;
	amount_cents: number;
	ticket_price_cents: number | null;
	session_price_cents: number | null;
	seats_per_session: number | null;
	currency: string;
	free_revisions: number | null;
	extra_revision_price_cents: number | null;
	promoted: boolean;
	view_count: number;
	seo_title: string | null;
	seo_description: string | null;
	create_category: string | null;
	published_at: string | null;
	created_at: string;
	updated_at: string;
}

/** A service blueprint as the console selects it. */
export interface CatalogueBlueprintRow extends OfferBlueprintColumns {
	id: string;
	slug: string;
	rating_average: number | string | null;
	rating_count: number | null;
	delivery_model: string;
	intake_fields: unknown;
	availability_preset_id: string | null;
}

/** A product as the console selects it. */
export interface CatalogueProductRow extends OfferProductColumns {
	id: string;
	slug: string;
	rating_average: number | string | null;
	rating_count: number | null;
	span: number;
}

/** The columns {@link CatalogueListingRow} selects. */
export const LISTING_COLUMNS =
	"id, owner_user_id, owner_team_id, kind, status, service_blueprint_id, product_id, title, description, description_text, category, delivery_label, amount_cents, ticket_price_cents, session_price_cents, seats_per_session, currency, free_revisions, extra_revision_price_cents, promoted, view_count, seo_title, seo_description, create_category, published_at, created_at, updated_at";
const BLUEPRINT_COLUMNS =
	"id, slug, rating_average, rating_count, delivery_model, intake_fields, stage_template, team_roles, deliverables, turnaround_days, session_minutes, session_count, meeting_provider, max_seats_per_cohort, allow_continuous_enrollment, availability_preset_id";
const PRODUCT_COLUMNS =
	"id, slug, rating_average, rating_count, span, format, licence, attribution_required, file_manifest";

interface SalesRow {
	listing_id: string;
	orders: number;
	revenue_minor: number;
	currency: string;
	week_start: string;
}

/** The most listings one seller's console reads at once. */
const SCOPE_WINDOW = 500;
const DAY = 86_400_000;
// #endregion

// #region Vocabulary
/** The database spelling of each delivery model. */
export const MODEL_TO_DB: Record<ServiceType, string> = {
	"Pipeline": "pipeline",
	"One-Off": "one_off",
	"Direct Deliverable": "direct_deliverable",
	"Session": "session",
	"Group Session": "group_session",
};
const DB_TO_MODEL: Record<string, ServiceType> = Object.fromEntries(
	Object.entries(MODEL_TO_DB).map(([label, db]) => [db, label as ServiceType]),
);

const STATUS_ORDER: readonly ListingStatus[] = ["published", "draft", "paused", "archived"];

function toWhole(minor: number | null | undefined, currency: string): number {
	return toMajorUnits(minor === null || minor === undefined ? 0 : Number(minor), currency) ?? 0;
}

function toWholeOrNull(minor: number | null | undefined, currency: string): number | null {
	return minor === null || minor === undefined ? null : toWhole(minor, currency);
}

function num(value: number | string | null | undefined): number {
	const n = typeof value === "string" ? Number(value) : value ?? 0;
	return Number.isFinite(n) ? n : 0;
}

/** `Edited today` / `Edited 3 days ago` / `Edited 2 weeks ago`. */
function editedLabel(iso: string, now = Date.now()): string {
	const diff = Math.floor(now / DAY) - Math.floor(Date.parse(iso) / DAY);
	if (!Number.isFinite(diff) || diff <= 0) return "Edited today";
	if (diff === 1) return "Edited yesterday";
	if (diff < 7) return `Edited ${diff} days ago`;
	const weeks = Math.round(diff / 7);
	return weeks <= 1 ? "Edited last week" : `Edited ${weeks} weeks ago`;
}

/** Normalise the numeric columns PostgREST may send as strings, and the currency's case. */
export function normaliseListing(l: CatalogueListingRow): CatalogueListingRow {
	return {
		...l,
		amount_cents: Number(l.amount_cents) || 0,
		view_count: Number(l.view_count) || 0,
		currency: (l.currency ?? "USD").toUpperCase(),
	};
}
// #endregion

// #region Scope
/** Whose listings the console shows: the acting team's, or the person's own (non-team) listings. */
interface Scope {
	userId: string;
	teamId: string | null;
}

function scopeOf(actor: ReadActor): Scope {
	return {
		userId: actor.userId,
		teamId: actor.contextType === "team" && actor.contextId ? actor.contextId : null,
	};
}
// #endregion

// #region Projection
/** Everything one listing's detail is mapped from — every read already made. */
export interface DetailInputs {
	listing: CatalogueListingRow;
	blueprint?: CatalogueBlueprintRow;
	product?: CatalogueProductRow;
	media: readonly ListingMediaRow[];
	refs: ReadonlyMap<string, MediaRef>;
	owner: ExploreOwner;
	metrics: ListingMetrics;
	skills?: SkillRef[];
	tags?: string[];
	collections?: string[];
	binding?: ListingAvailabilityBinding | null;
}

function pricingOf(l: CatalogueListingRow): ListingPricing {
	return {
		amount: toWhole(l.amount_cents, l.currency),
		ticketPrice: toWholeOrNull(l.ticket_price_cents, l.currency),
		sessionPrice: toWholeOrNull(l.session_price_cents, l.currency),
		seatsPerSession: l.seats_per_session,
		freeRevisions: l.free_revisions,
		extraRevisionPrice: toWholeOrNull(l.extra_revision_price_cents, l.currency),
	};
}

function spanOf(span: number | undefined): 1 | 2 | 3 {
	return !span || span <= 1 ? 1 : span >= 3 ? 3 : 2;
}

/**
 * One listing's full editable detail from its rows. Pure. The summary fields (`cover`, `price`,
 * `needsAttention`) are derived from the same projection, so the console row and the workspace never
 * disagree about a listing.
 */
export function projectDetail(input: DetailInputs): ListingDetail {
	const l = input.listing;
	const serviceType = l.kind === "service"
		? DB_TO_MODEL[input.blueprint?.delivery_model ?? ""] ?? "One-Off"
		: null;
	const archetype = formArchetypeOf(l.kind, serviceType);
	const pricing = pricingOf(l);
	const media = listingMediaSlots(input.media, input.refs);
	const offer = archetype === "product"
		? offerFromProduct(
			input.product ??
				{ format: "download", licence: "personal", attribution_required: false, file_manifest: [] },
		)
		: offerFromBlueprint(archetype, input.blueprint ?? EMPTY_BLUEPRINT);
	const intake = IntakeFieldSchema.array().safeParse(input.blueprint?.intake_fields ?? []);
	const createCategory = CreateCategory.safeParse(l.create_category);

	const detail: ListingDetail = {
		deletable: false,
		id: (input.blueprint ?? input.product)?.slug ?? l.id,
		ownerId: input.owner.handle,
		kind: l.kind,
		serviceType,
		title: l.title,
		category: l.category,
		status: l.status,
		currency: l.currency,
		cover: coverOf(media)?.thumb ?? null,
		price: resolveListingPricing({ kind: l.kind, serviceType, pricing, currency: l.currency }),
		metrics: input.metrics,
		updatedAt: new Date(l.updated_at).toISOString(),
		listedAt: l.published_at ?? l.created_at,
		updatedLabel: editedLabel(l.updated_at),
		promoted: l.promoted,
		needsAttention: false,
		owner: input.owner,
		description: l.description?.html ?? "",
		descriptionText: l.description_text,
		media,
		skills: input.skills ?? [],
		tags: input.tags ?? [],
		createCategory: createCategory.success ? createCategory.data : null,
		pricing,
		delivery: l.delivery_label,
		offer,
		seo: { seoTitle: l.seo_title ?? "", seoDescription: l.seo_description ?? "" },
		availabilityBinding: archetype === "session" || archetype === "cohort"
			? input.binding ?? null
			: null,
		collections: input.collections ?? [],
		intake: l.kind === "service" && intake.success ? intake.data : [],
		span: l.kind === "product" ? spanOf(input.product?.span) : 1,
		publishedAt: l.published_at,
	};
	const live = detail.status === "draft" || detail.status === "published";
	return { ...detail, needsAttention: live && !publishReadiness(detail).ready };
}

const EMPTY_BLUEPRINT: OfferBlueprintColumns = {
	stage_template: [],
	team_roles: [],
	deliverables: [],
	turnaround_days: null,
	session_minutes: null,
	session_count: null,
	meeting_provider: null,
	max_seats_per_cohort: null,
	allow_continuous_enrollment: null,
};

/** The console row of a detail. */
export function summaryOf(detail: ListingDetail): ListingSummary {
	return {
		id: detail.id,
		ownerId: detail.ownerId,
		kind: detail.kind,
		serviceType: detail.serviceType,
		title: detail.title,
		category: detail.category,
		status: detail.status,
		currency: detail.currency,
		cover: detail.cover,
		price: detail.price,
		metrics: detail.metrics,
		updatedAt: detail.updatedAt,
		listedAt: detail.listedAt,
		updatedLabel: detail.updatedLabel,
		promoted: detail.promoted,
		needsAttention: detail.needsAttention,
		deletable: false,
	};
}

/** The listing ids among `ids` the viewer may hard-delete: created by them, never engaged with. */
async function deletableIds(db: SupabaseClient, ids: readonly string[]): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const { data, error } = await db.schema("catalogue").rpc("get_listing_engagement", {
		p_listings: ids,
	});
	if (error) throw new Error(`catalogue.get_listing_engagement failed: ${error.message}`);
	return new Set(
		((data ?? []) as Array<{ listing_id: string; engagements: number }>)
			.filter((r) => r.engagements === 0)
			.map((r) => r.listing_id),
	);
}

async function withDeletable(
	db: SupabaseClient,
	items: ListingSummary[],
	uuidBySlug: ReadonlyMap<string, string>,
): Promise<ListingSummary[]> {
	const free = await deletableIds(db, items.flatMap((i) => uuidBySlug.get(i.id) ?? []));
	return items.map((i) => ({ ...i, deletable: free.has(uuidBySlug.get(i.id) ?? "") }));
}
// #endregion

// #region Reads
interface Loaded {
	listings: CatalogueListingRow[];
	blueprints: Map<string, CatalogueBlueprintRow>;
	products: Map<string, CatalogueProductRow>;
	media: Map<string, ListingMediaRow[]>;
	refs: Map<string, MediaRef>;
	bindings: Map<string, ListingAvailabilityBinding>;
}

async function loadScope(db: SupabaseClient, scope: Scope): Promise<Loaded> {
	let q = db.schema("catalogue").from("listings").select(LISTING_COLUMNS);
	q = scope.teamId
		? q.eq("owner_team_id", scope.teamId)
		: q.eq("owner_user_id", scope.userId).is("owner_team_id", null);
	const { data, error } = await q.order("updated_at", { ascending: false }).limit(SCOPE_WINDOW);
	if (error) throw new Error(`catalogue.listings read failed: ${error.message}`);
	return await withChildren(db, ((data ?? []) as CatalogueListingRow[]).map(normaliseListing));
}

async function withChildren(db: SupabaseClient, listings: CatalogueListingRow[]): Promise<Loaded> {
	const bpIds = listings.flatMap((l) => l.service_blueprint_id ? [l.service_blueprint_id] : []);
	const prodIds = listings.flatMap((l) => l.product_id ? [l.product_id] : []);
	const ids = listings.map((l) => l.id);
	const [bps, prods, media] = await Promise.all([
		bpIds.length
			? db.schema("marketplace").from("service_blueprints").select(BLUEPRINT_COLUMNS).in(
				"id",
				bpIds,
			)
			: Promise.resolve({ data: [], error: null }),
		prodIds.length
			? db.schema("catalogue").from("products").select(PRODUCT_COLUMNS).in("id", prodIds)
			: Promise.resolve({ data: [], error: null }),
		ids.length
			? db.schema("catalogue").from("listing_media").select(LISTING_MEDIA_COLUMNS).in(
				"listing_id",
				ids,
			)
			: Promise.resolve({ data: [], error: null }),
	]);
	if (bps.error) {
		throw new Error(`marketplace.service_blueprints read failed: ${bps.error.message}`);
	}
	if (prods.error) throw new Error(`catalogue.products read failed: ${prods.error.message}`);
	if (media.error) throw new Error(`catalogue.listing_media read failed: ${media.error.message}`);

	const blueprints = new Map(((bps.data ?? []) as CatalogueBlueprintRow[]).map((b) => [b.id, b]));
	const mediaRows = (media.data ?? []) as ListingMediaRow[];
	const [refs, bindings] = await Promise.all([
		fetchPublicMedia(db, listingMediaFileIds(mediaRows)),
		bindingsFor(db, [...blueprints.values()]),
	]);
	return {
		listings,
		blueprints,
		products: new Map(((prods.data ?? []) as CatalogueProductRow[]).map((p) => [p.id, p])),
		media: mediaRowsByListing(mediaRows),
		refs,
		bindings,
	};
}

/**
 * The availability each booked-time blueprint uses: its bound preset, or its owner schedule's default
 * (`scheduling.fn_preset_for_blueprint`, the gate's own resolver). A blueprint with neither has no
 * binding, which the publish gate reports as "Choose availability".
 */
async function bindingsFor(
	db: SupabaseClient,
	blueprints: readonly CatalogueBlueprintRow[],
): Promise<Map<string, ListingAvailabilityBinding>> {
	const timed = blueprints.filter((b) =>
		b.delivery_model === "session" || b.delivery_model === "group_session"
	);
	const out = new Map<string, ListingAvailabilityBinding>();
	if (timed.length === 0) return out;
	const resolved = await Promise.all(timed.map(async (b) => {
		const { data, error } = await db.schema("scheduling").rpc("fn_preset_for_blueprint", {
			p_blueprint: b.id,
		});
		if (error) throw new Error(`scheduling.fn_preset_for_blueprint failed: ${error.message}`);
		return { blueprint: b, presetId: (data as string | null) ?? null };
	}));
	const presetIds = [...new Set(resolved.flatMap((r) => r.presetId ? [r.presetId] : []))];
	if (presetIds.length === 0) return out;
	const { data, error } = await db.schema("scheduling").from("availability_presets")
		.select("id, name, scope").in("id", presetIds);
	if (error) throw new Error(`scheduling.availability_presets read failed: ${error.message}`);
	const presets = new Map(
		((data ?? []) as Array<{ id: string; name: string; scope: string }>).map((p) => [p.id, p]),
	);
	for (const { blueprint, presetId } of resolved) {
		const preset = presetId ? presets.get(presetId) : undefined;
		if (!preset) continue;
		const bound = blueprint.availability_preset_id === preset.id;
		out.set(blueprint.id, {
			mode: !bound ? "default" : preset.scope === "service" ? "override" : "preset",
			presetId: bound ? preset.id : null,
			presetName: preset.name.slice(0, 60),
		});
	}
	return out;
}

async function salesFor(
	db: SupabaseClient,
	ids: string[],
	since: string | null,
): Promise<SalesRow[]> {
	if (ids.length === 0) return [];
	const { data, error } = await db.schema("catalogue").rpc("get_listing_sales", {
		p_listing_ids: ids,
		p_since: since,
	});
	if (error) throw new Error(`catalogue.get_listing_sales failed: ${error.message}`);
	return ((data ?? []) as SalesRow[]).map((r) => ({
		...r,
		orders: Number(r.orders) || 0,
		revenue_minor: Number(r.revenue_minor) || 0,
		currency: (r.currency ?? "USD").toUpperCase(),
	}));
}

/**
 * A listing's light metrics: its own view counter, its sales (converted into the listing's currency)
 * and its subject's review average, rounded to one decimal as the card prints it.
 */
export function metricsOf(
	l: CatalogueListingRow,
	subject: { rating_average: number | string | null; rating_count: number | null } | undefined,
	sales: readonly SalesRow[],
	convert: (minor: number, from: string, to: string) => number,
): ListingMetrics {
	let orders = 0;
	let revenueMinor = 0;
	for (const s of sales) {
		if (s.listing_id !== l.id) continue;
		orders += s.orders;
		revenueMinor += convert(s.revenue_minor, s.currency, l.currency);
	}
	const revenue = toWhole(revenueMinor, l.currency);
	return {
		views: l.view_count,
		orders,
		revenue,
		revenueLabel: money(revenue, l.currency),
		avgRating: Math.round(num(subject?.rating_average) * 10) / 10,
		ratingCount: Number(subject?.rating_count) || 0,
		trend: [],
	};
}

function detailOf(
	loaded: Loaded,
	l: CatalogueListingRow,
	owner: ExploreOwner,
	sales: readonly SalesRow[],
	convert: (minor: number, from: string, to: string) => number,
	children: Pick<DetailInputs, "skills" | "tags" | "collections"> = {},
): ListingDetail {
	const blueprint = l.service_blueprint_id
		? loaded.blueprints.get(l.service_blueprint_id)
		: undefined;
	const product = l.product_id ? loaded.products.get(l.product_id) : undefined;
	return projectDetail({
		listing: l,
		blueprint,
		product,
		media: loaded.media.get(l.id) ?? [],
		refs: loaded.refs,
		owner,
		metrics: metricsOf(l, blueprint ?? product, sales, convert),
		binding: blueprint ? loaded.bindings.get(blueprint.id) ?? null : null,
		...children,
	});
}

/** The owner a console listing credits: its team when team-owned, else the seller themselves. */
async function ownerFor(scope: Scope): Promise<ExploreOwner> {
	const { data } = await getAnonClient().schema("org").from("profiles_index")
		.select("handle, name, avatar_bucket, avatar_path, entity_type, verified, verification_stamp")
		.eq("entity_id", scope.teamId ?? scope.userId)
		.maybeSingle();
	const row = data as
		| {
			handle: string;
			name: string;
			avatar_bucket: string | null;
			avatar_path: string | null;
			entity_type: ExploreOwner["kind"];
			verified: boolean;
			verification_stamp: string | null;
		}
		| null;
	return {
		handle: row ? `@${row.handle}` : "",
		name: row?.name ?? "",
		avatar: row ? publicObjectUrl(row.avatar_bucket, row.avatar_path) ?? "" : "",
		kind: row?.entity_type ?? "freelancer",
		verified: row?.verified ?? false,
		verificationStamp: VerificationStampSchema.safeParse(row?.verification_stamp).data,
	};
}

/**
 * Currency conversion for sales totals: identity within a currency, the FX table across them. The
 * table is fetched only when some sale was made in a currency other than its listing's — which is
 * rare, and not worth a rates read on every console load.
 */
async function converter(
	listings: readonly CatalogueListingRow[],
	sales: readonly SalesRow[],
): Promise<(minor: number, from: string, to: string) => number> {
	const currencyOf = new Map(listings.map((l) => [l.id, l.currency]));
	const mixed = sales.some((s) => s.currency !== currencyOf.get(s.listing_id));
	const table = mixed ? await FxService.rates(PLATFORM_BASE_CURRENCY) : null;
	return (minor, from, to) => {
		if (from === to || !table) return minor;
		const projector = projectorFor(to, table);
		return projector.canConvert(from) ? projector.convertMinor(minor, from) : 0;
	};
}
// #endregion

// #region List
function priceValue(s: ListingSummary): number {
	return s.price.min ?? (Number(String(s.price.display).replace(/[^0-9.]/g, "")) || 0);
}

function ascCompare(
	sort: CatalogueListParams["sort"],
	a: ListingSummary,
	b: ListingSummary,
): number {
	switch (sort) {
		case "title":
			return a.title.localeCompare(b.title, "en", { numeric: true, sensitivity: "base" });
		case "best-selling":
			return a.metrics.orders - b.metrics.orders;
		case "views":
			return a.metrics.views - b.metrics.views;
		case "price":
			return priceValue(a) - priceValue(b);
		case "rating":
			return a.metrics.avgRating - b.metrics.avgRating;
		case "status":
			return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
		case "recent":
		default:
			return a.updatedAt.localeCompare(b.updatedAt);
	}
}

/**
 * The header rollups, over the seller's listings in the active type segment. The sales figures are the
 * Analytics read's own tiles for that scope and window ({@link liveHeadline}), so the header and the
 * Analytics canvas count the same rollups over the same days; what is live and the average review are
 * counted here, over the non-archived listings.
 */
async function statsFor(
	db: SupabaseClient,
	actor: ReadActor,
	live: CatalogueListingRow[],
	details: ReadonlyMap<string, ListingDetail>,
	type: CatalogueTypeFilter,
	period: AnalyticsPeriod,
	display: string,
): Promise<CatalogueStats> {
	const headline = await liveHeadline(db, actor, type, period, display, new Date());
	let ratingSum = 0;
	let ratingWeight = 0;
	for (const l of live) {
		const metrics = details.get(l.id)?.metrics;
		if (metrics && metrics.ratingCount > 0) {
			ratingSum += metrics.avgRating * metrics.ratingCount;
			ratingWeight += metrics.ratingCount;
		}
	}
	return {
		...headline,
		activeListings: live.filter((l) => l.status === "published").length,
		totalListings: live.length,
		views: live.reduce((sum, l) => sum + l.view_count, 0),
		avgRating: ratingWeight > 0 ? Math.round((ratingSum / ratingWeight) * 10) / 10 : 0,
	};
}

function facetCountsOf(listings: readonly ListingDetail[]): CatalogueFacetCounts {
	const out: CatalogueFacetCounts = {
		model: {},
		create: {},
		needsAttention: 0,
		promoted: 0,
		bestSelling: 0,
	};
	for (const d of listings) {
		if (d.serviceType) out.model[d.serviceType] = (out.model[d.serviceType] ?? 0) + 1;
		if (d.createCategory) out.create[d.createCategory] = (out.create[d.createCategory] ?? 0) + 1;
		if (d.needsAttention) out.needsAttention++;
		if (d.promoted) out.promoted++;
		if (d.metrics.orders > 0) out.bestSelling++;
	}
	return out;
}

/** A filtered, sorted, paged page of the acting seller's listings, with the KPI roll-up. */
export async function listListings(
	params: CatalogueListParams,
	actor: ReadActor & { accessToken: string },
	display: string,
): Promise<CataloguePage> {
	const db = getUserClient(actor.accessToken);
	const scope = scopeOf(actor);
	const [loaded, owner] = await Promise.all([loadScope(db, scope), ownerFor(scope)]);
	const allTime = await salesFor(db, loaded.listings.map((l) => l.id), null);
	const convert = await converter(loaded.listings, allTime);
	const details = new Map(
		loaded.listings.map((l) => [l.id, detailOf(loaded, l, owner, allTime, convert)] as const),
	);
	const all = [...details.values()].map(summaryOf);

	const creates = new Set(params.createCategory ?? []);
	let items = creates.size
		? [...details.values()].filter((d) => d.createCategory && creates.has(d.createCategory)).map(
			summaryOf,
		)
		: all.slice();
	if (params.type && params.type !== "all") items = items.filter((d) => d.kind === params.type);
	const statuses = new Set(params.status ?? []);
	if (statuses.size) items = items.filter((d) => statuses.has(d.status));
	const models = new Set(params.model ?? []);
	if (models.size) {
		items = items.filter((d) => d.serviceType !== null && models.has(d.serviceType));
	}
	if (params.needsAttention) items = items.filter((d) => d.needsAttention);
	if (params.promoted) items = items.filter((d) => d.promoted);
	if (params.bestSelling) items = items.filter((d) => d.metrics.orders > 0);
	if (params.search) {
		const q = params.search.toLowerCase();
		items = items.filter((d) =>
			d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)
		);
	}

	const sort = params.sort ?? "recent";
	const defaultDesc = sort === "recent" || sort === "best-selling" || sort === "rating";
	const dir = params.dir ?? (defaultDesc ? "desc" : "asc");
	items.sort((a, b) => {
		const c = ascCompare(sort, a, b) || a.id.localeCompare(b.id);
		return dir === "desc" ? -c : c;
	});

	const total = items.length;
	const limit = Math.min(200, Math.max(1, params.limit ?? 60));
	let start = 0;
	if (params.cursor) {
		const at = items.findIndex((d) => d.id === params.cursor);
		start = at >= 0 ? at + 1 : 0;
	}
	const uuidBySlug = new Map([...details].map(([uuid, d]) => [d.id, uuid] as const));
	const pageItems = await withDeletable(db, items.slice(start, start + limit), uuidBySlug);

	const counts = { draft: 0, published: 0, paused: 0, archived: 0 };
	for (const d of all) counts[d.status]++;
	const facetCounts = facetCountsOf([...details.values()]);

	const live = loaded.listings.filter((l) =>
		l.status !== "archived" && (!params.type || params.type === "all" || l.kind === params.type)
	);
	return {
		items: pageItems,
		hasMore: start + limit < total,
		nextCursor: start + limit < total ? pageItems[pageItems.length - 1]?.id ?? null : null,
		total,
		statusCounts: counts,
		facetCounts,
		stats: await statsFor(
			db,
			actor,
			live,
			details,
			params.type ?? "all",
			params.period ?? "30d",
			display,
		),
		viewerId: owner.handle,
	};
}
// #endregion

// #region Detail
/** The listing row a console address (`svc-…` / `prd-…`) names, if the caller can see it. */
export async function listingBySlug(
	db: SupabaseClient,
	slug: string,
): Promise<CatalogueListingRow | null> {
	const isService = slug.startsWith("svc-");
	const isProduct = slug.startsWith("prd-");
	if (!isService && !isProduct) return null;
	const { data: subject, error } =
		await (isService
			? db.schema("marketplace").from("service_blueprints").select("id").eq("slug", slug)
				.maybeSingle()
			: db.schema("catalogue").from("products").select("id").eq("slug", slug).maybeSingle());
	if (error) throw new Error(`listing subject read failed: ${error.message}`);
	if (!subject) return null;
	const { data, error: listingError } = await db.schema("catalogue").from("listings").select(
		LISTING_COLUMNS,
	)
		.eq(isService ? "service_blueprint_id" : "product_id", (subject as { id: string }).id)
		.maybeSingle();
	if (listingError) throw new Error(`catalogue.listings read failed: ${listingError.message}`);
	return data ? normaliseListing(data as CatalogueListingRow) : null;
}

/** The caller's own listing a console address names, or `null` — a stranger's is not theirs to manage. */
export async function ownedListing(
	db: SupabaseClient,
	slug: string,
	actor: ReadActor,
): Promise<CatalogueListingRow | null> {
	const l = await listingBySlug(db, slug);
	return l && ownsListing(l, actor) ? l : null;
}

/** One listing's full editable detail, or `null` when it is not the caller's to manage. */
export async function listingDetail(
	slug: string,
	actor: ReadActor & { accessToken: string },
): Promise<ListingDetail | null> {
	const db = getUserClient(actor.accessToken);
	const l = await ownedListing(db, slug, actor);
	if (!l) return null;

	const scope: Scope = { userId: l.owner_user_id, teamId: l.owner_team_id };
	const [loaded, owner, skills, tags, collections, sales] = await Promise.all([
		withChildren(db, [l]),
		ownerFor(scope),
		db.schema("catalogue").from("listing_skills").select("skill_id").eq("listing_id", l.id),
		db.schema("catalogue").from("listing_tags").select("tag").eq("listing_id", l.id),
		db.schema("catalogue").from("collection_listings").select("collection_id").eq(
			"listing_id",
			l.id,
		),
		salesFor(db, [l.id], null),
	]);
	for (const r of [skills, tags, collections]) {
		if (r.error) throw new Error(`listing detail read failed: ${r.error.message}`);
	}

	const skillIds = ((skills.data ?? []) as Array<{ skill_id: string }>).map((s) => s.skill_id);
	const collectionIds = ((collections.data ?? []) as Array<{ collection_id: string }>).map((c) =>
		c.collection_id
	);
	const [skillRows, collectionRows] = await Promise.all([
		skillIds.length
			? db.schema("org").from("skills").select("id, label").in("id", skillIds)
			: Promise.resolve({ data: [], error: null }),
		collectionIds.length
			? db.schema("catalogue").from("collections").select("id, name").in("id", collectionIds)
			: Promise.resolve({ data: [], error: null }),
	]);
	if (skillRows.error) throw new Error(`org.skills read failed: ${skillRows.error.message}`);
	if (collectionRows.error) {
		throw new Error(`catalogue.collections read failed: ${collectionRows.error.message}`);
	}

	const [convert, free] = await Promise.all([converter([l], sales), deletableIds(db, [l.id])]);
	const labelById = new Map(
		((skillRows.data ?? []) as Array<{ id: string; label: string }>).map((s) => [s.id, s.label]),
	);
	const detail = detailOf(loaded, l, owner, sales, convert, {
		skills: skillIds.flatMap((id) => {
			const label = labelById.get(id);
			return label ? [resolveSkill(label)] : [];
		}),
		tags: ((tags.data ?? []) as Array<{ tag: string }>).map((t) => t.tag),
		collections: ((collectionRows.data ?? []) as Array<{ name: string }>).map((c) => c.name),
	});
	return { ...detail, deletable: free.has(l.id) };
}
// #endregion
