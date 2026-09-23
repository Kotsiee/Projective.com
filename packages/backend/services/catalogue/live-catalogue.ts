import type { SupabaseClient } from "supabaseClient";
import {
	type CatalogueListParams,
	type CataloguePage,
	type CataloguePeriod,
	type CatalogueStats,
	type CreateListingInput,
	type ListingAvailability,
	type ListingDetail,
	type ListingMetrics,
	type ListingPricing,
	type ListingStatus,
	type ListingSummary,
	money,
	periodDays,
	publishReadiness,
	resolveListingPricing,
	type ServiceType,
	type SetListingStatusInput,
	type UpdateListingInput,
} from "@projective/types/catalogue";
import type { ExploreOwner, SkillRef } from "@projective/types/explore";
import { IntakeFieldSchema, type IntakeField } from "@projective/types/services";
import { flattenRichText } from "@projective/types/richtext";
import { PLATFORM_BASE_CURRENCY, toMajorUnits, toMinorUnits } from "@projective/types/finance";
import { getAnonClient, getUserClient } from "../../core/supabase.ts";
import { parsePublicObjectUrl, publicObjectUrl } from "../../core/storage-url.ts";
import { resolveSkill } from "../explore/skills.ts";
import { projectorFor } from "../finance/commerce-money.ts";
import { FxService } from "../finance/FxService.ts";
import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";

/**
 * live-catalogue — the seller console's reads and writes, as the signed-in seller.
 *
 * Reads go through the seller's own client, so the catalogue policies decide what they see: their own
 * listings in every state, and nothing of anyone else's that is not published. Sales come from
 * `catalogue.get_listing_sales`, the one definer, which answers only for the caller's own listings.
 * Writes go through the three `catalogue.*` doors, which keep a listing and its product or service
 * blueprint in step in one transaction.
 *
 * A listing's ADDRESS is its subject's slug — `svc-…` for a service, `prd-…` for a product — the same
 * one its public `/view/[id]` page answers to, so the console and the storefront name a listing the
 * same way.
 */

type Result<T> = ServiceResult<T>;

// #region Rows
interface ListingRow {
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
	updated_at: string;
}

interface SubjectRow {
	id: string;
	slug: string;
	rating_average: number | string | null;
	rating_count: number | null;
	delivery_model?: string;
	intake_fields?: unknown;
}

interface MediaRow {
	listing_id: string;
	file_id: string | null;
	url: string | null;
	position: number;
}

interface SalesRow {
	listing_id: string;
	orders: number;
	revenue_minor: number;
	currency: string;
	week_start: string;
}

const LISTING_COLUMNS =
	"id, owner_user_id, owner_team_id, kind, status, service_blueprint_id, product_id, title, description, description_text, category, delivery_label, amount_cents, ticket_price_cents, session_price_cents, seats_per_session, currency, free_revisions, extra_revision_price_cents, promoted, view_count, updated_at";

/** The most listings one seller's console reads at once. */
const SCOPE_WINDOW = 500;
const DAY = 86_400_000;
// #endregion

// #region Vocabulary
const MODEL_TO_DB: Record<ServiceType, string> = {
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

/** `Edited today` / `Edited 3 days ago` / `Edited 2 weeks ago`. */
function editedLabel(iso: string, now = Date.now()): string {
	const diff = Math.floor(now / DAY) - Math.floor(Date.parse(iso) / DAY);
	if (!Number.isFinite(diff) || diff <= 0) return "Edited today";
	if (diff === 1) return "Edited yesterday";
	if (diff < 7) return `Edited ${diff} days ago`;
	const weeks = Math.round(diff / 7);
	return weeks <= 1 ? "Edited last week" : `Edited ${weeks} weeks ago`;
}

/** A compact money label (`$12.9K`) above ten thousand, the whole figure below it. */
function compactMoney(whole: number, currency: string): string {
	if (whole < 10_000) return money(whole, currency);
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
			notation: "compact",
			maximumFractionDigits: 1,
		}).format(whole);
	} catch {
		return money(whole, currency);
	}
}

function refuse<T>(status: number, message: string, errors?: Record<string, string>): Result<T> {
	return fail(status, { message, errors }) as Result<T>;
}

/** HTTP status for a refusal from the catalogue doors. */
function statusFor(code: string | undefined): number {
	switch (code) {
		case "42501":
			return 403;
		case "PB404":
			return 404;
		case "PG422":
		case "22023":
		case "23514":
		case "22P02":
			return 422;
		default:
			return 503;
	}
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

// #region Reads
interface Loaded {
	listings: ListingRow[];
	subjects: Map<string, SubjectRow>;
	media: Map<string, MediaRow[]>;
	fileUrls: Map<string, string>;
}

async function loadScope(db: SupabaseClient, scope: Scope, only?: string[]): Promise<Loaded> {
	let q = db.schema("catalogue").from("listings").select(LISTING_COLUMNS);
	q = scope.teamId ? q.eq("owner_team_id", scope.teamId) : q.eq("owner_user_id", scope.userId).is("owner_team_id", null);
	if (only) q = q.in("id", only);
	const { data, error } = await q.order("updated_at", { ascending: false }).limit(SCOPE_WINDOW);
	if (error) throw new Error(`catalogue.listings read failed: ${error.message}`);
	const listings = ((data ?? []) as ListingRow[]).map((l) => ({
		...l,
		amount_cents: Number(l.amount_cents) || 0,
		view_count: Number(l.view_count) || 0,
		currency: (l.currency ?? "USD").toUpperCase(),
	}));
	return await withChildren(db, listings);
}

async function withChildren(db: SupabaseClient, listings: ListingRow[]): Promise<Loaded> {
	const bpIds = listings.flatMap((l) => l.service_blueprint_id ? [l.service_blueprint_id] : []);
	const prodIds = listings.flatMap((l) => l.product_id ? [l.product_id] : []);
	const ids = listings.map((l) => l.id);
	const [bps, prods, media] = await Promise.all([
		bpIds.length
			? db.schema("marketplace").from("service_blueprints")
				.select("id, slug, rating_average, rating_count, delivery_model, intake_fields").in("id", bpIds)
			: Promise.resolve({ data: [], error: null }),
		prodIds.length
			? db.schema("catalogue").from("products").select("id, slug, rating_average, rating_count").in("id", prodIds)
			: Promise.resolve({ data: [], error: null }),
		ids.length
			? db.schema("catalogue").from("listing_media").select("listing_id, file_id, url, position").in("listing_id", ids)
			: Promise.resolve({ data: [], error: null }),
	]);
	if (bps.error) throw new Error(`marketplace.service_blueprints read failed: ${bps.error.message}`);
	if (prods.error) throw new Error(`catalogue.products read failed: ${prods.error.message}`);
	if (media.error) throw new Error(`catalogue.listing_media read failed: ${media.error.message}`);

	const subjects = new Map<string, SubjectRow>();
	for (const s of [...(bps.data ?? []), ...(prods.data ?? [])] as SubjectRow[]) subjects.set(s.id, s);

	const byListing = new Map<string, MediaRow[]>();
	for (const m of (media.data ?? []) as MediaRow[]) {
		const list = byListing.get(m.listing_id) ?? [];
		list.push(m);
		byListing.set(m.listing_id, list);
	}
	for (const list of byListing.values()) list.sort((a, b) => a.position - b.position);

	// Gallery files are the seller's own, readable under their policies; only a PUBLIC one has a URL
	// a buyer could load, so a private file shows as absent rather than as a link that 404s.
	const fileIds = [...new Set([...byListing.values()].flat().flatMap((m) => m.file_id ? [m.file_id] : []))];
	const fileUrls = new Map<string, string>();
	if (fileIds.length) {
		const { data: files, error: filesError } = await db.schema("files").from("items")
			.select("id, bucket_id, storage_path").in("id", fileIds);
		if (filesError) throw new Error(`files.items read failed: ${filesError.message}`);
		for (const f of (files ?? []) as Array<{ id: string; bucket_id: string; storage_path: string }>) {
			const url = publicObjectUrl(f.bucket_id, f.storage_path);
			if (url) fileUrls.set(f.id, url);
		}
	}
	return { listings, subjects, media: byListing, fileUrls };
}

function subjectOf(loaded: Loaded, l: ListingRow): SubjectRow | undefined {
	return loaded.subjects.get((l.service_blueprint_id ?? l.product_id) as string);
}

function galleryOf(loaded: Loaded, l: ListingRow): string[] {
	return (loaded.media.get(l.id) ?? []).flatMap((m) => {
		const src = m.file_id ? loaded.fileUrls.get(m.file_id) : m.url;
		return src ? [src] : [];
	});
}

async function salesFor(db: SupabaseClient, ids: string[], since: string | null): Promise<SalesRow[]> {
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
// #endregion

// #region Projection
function pricingOf(l: ListingRow): ListingPricing {
	return {
		amount: toWhole(l.amount_cents, l.currency),
		ticketPrice: toWholeOrNull(l.ticket_price_cents, l.currency),
		sessionPrice: toWholeOrNull(l.session_price_cents, l.currency),
		seatsPerSession: l.seats_per_session,
		freeRevisions: l.free_revisions,
		extraRevisionPrice: toWholeOrNull(l.extra_revision_price_cents, l.currency),
	};
}

function serviceTypeOf(loaded: Loaded, l: ListingRow): ServiceType | null {
	if (l.kind !== "service") return null;
	return DB_TO_MODEL[subjectOf(loaded, l)?.delivery_model ?? ""] ?? "One-Off";
}

function metricsOf(
	loaded: Loaded,
	l: ListingRow,
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
	const subject = subjectOf(loaded, l);
	const revenue = toWhole(revenueMinor, l.currency);
	return {
		views: l.view_count,
		orders,
		revenue,
		revenueLabel: money(revenue, l.currency),
		avgRating: Math.round((Number(subject?.rating_average) || 0) * 10) / 10,
		ratingCount: Number(subject?.rating_count) || 0,
		trend: [],
	};
}

/** Whether a listing wants its seller's eye: a draft that cannot publish, or a live one missing a gate. */
function needsAttention(detail: Pick<ListingDetail, "status" | "title" | "pricing" | "media">): boolean {
	if (detail.status === "draft" || detail.status === "published") {
		return !publishReadiness(detail as ListingDetail).ready;
	}
	return false;
}

function summaryOf(
	loaded: Loaded,
	l: ListingRow,
	owner: ExploreOwner,
	sales: readonly SalesRow[],
	convert: (minor: number, from: string, to: string) => number,
): ListingSummary {
	const serviceType = serviceTypeOf(loaded, l);
	const pricing = pricingOf(l);
	const media = galleryOf(loaded, l);
	return {
		id: subjectOf(loaded, l)?.slug ?? l.id,
		ownerId: owner.handle,
		kind: l.kind,
		serviceType,
		title: l.title,
		category: l.category,
		status: l.status,
		currency: l.currency,
		cover: media[0] ?? null,
		price: resolveListingPricing({ kind: l.kind, serviceType, pricing, currency: l.currency }),
		metrics: metricsOf(loaded, l, sales, convert),
		updatedAt: new Date(l.updated_at).toISOString(),
		updatedLabel: editedLabel(l.updated_at),
		promoted: l.promoted,
		needsAttention: needsAttention({ status: l.status, title: l.title, pricing, media }),
	};
}

/** The owner a console listing credits: its team when team-owned, else the seller themselves. */
async function ownerFor(scope: Scope): Promise<ExploreOwner> {
	const { data } = await getAnonClient().schema("org").from("profiles_index")
		.select("handle, name, avatar_bucket, avatar_path, entity_type, verified")
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
		}
		| null;
	return {
		handle: row ? `@${row.handle}` : "",
		name: row?.name ?? "",
		avatar: row ? publicObjectUrl(row.avatar_bucket, row.avatar_path) ?? "" : "",
		kind: row?.entity_type ?? "freelancer",
		verified: row?.verified ?? false,
	};
}

/**
 * Currency conversion for sales totals: identity within a currency, the FX table across them. The
 * table is fetched only when some sale was made in a currency other than its listing's — which is
 * rare, and not worth a rates read on every console load.
 */
async function converter(
	listings: readonly ListingRow[],
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

function ascCompare(sort: CatalogueListParams["sort"], a: ListingSummary, b: ListingSummary): number {
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
 * The KPI strip, counted over the chosen window across the seller's non-archived listings in the
 * active type segment. Revenue is shown in the single currency the sales were made in; only when a
 * seller has sold in several is it converted, into the viewer's display currency.
 */
async function statsFor(
	db: SupabaseClient,
	live: ListingRow[],
	loaded: Loaded,
	period: CataloguePeriod,
	display: string,
): Promise<CatalogueStats> {
	const days = periodDays(period);
	const since = new Date(Date.now() - days * DAY);
	const window = await salesFor(db, live.map((l) => l.id), since.toISOString());
	const currencies = new Set(window.map((s) => s.currency));
	// One currency sold in: report in it, unconverted. None yet: the seller's own pricing currency. Several:
	// the viewer's display currency, converted — the only case in which a rate touches the figure.
	const target = currencies.size === 1
		? [...currencies][0]
		: currencies.size === 0
		? live[0]?.currency ?? display
		: display;
	let convertTo = (minor: number, _from: string) => minor;
	if (currencies.size > 1) {
		const table = await FxService.rates(PLATFORM_BASE_CURRENCY);
		const projector = projectorFor(target, table);
		convertTo = (minor, from) => projector.canConvert(from) ? projector.convertMinor(minor, from) : 0;
	}

	let orders = 0;
	let revenueMinor = 0;
	const weeks = Math.max(1, Math.ceil(days / 7));
	const trendMinor = new Array<number>(weeks).fill(0);
	for (const s of window) {
		orders += s.orders;
		const minor = convertTo(s.revenue_minor, s.currency);
		revenueMinor += minor;
		const age = Math.floor((Date.now() - Date.parse(s.week_start)) / (7 * DAY));
		const bucket = weeks - 1 - Math.min(weeks - 1, Math.max(0, age));
		trendMinor[bucket] += minor;
	}

	let ratingSum = 0;
	let ratingWeight = 0;
	for (const l of live) {
		const subject = subjectOf(loaded, l);
		const count = Number(subject?.rating_count) || 0;
		if (count > 0) {
			ratingSum += (Number(subject?.rating_average) || 0) * count;
			ratingWeight += count;
		}
	}
	const revenue = toWhole(revenueMinor, target);
	return {
		activeListings: live.filter((l) => l.status === "published").length,
		totalListings: live.length,
		views: live.reduce((sum, l) => sum + l.view_count, 0),
		period,
		orders,
		revenue,
		revenueLabel: compactMoney(revenue, target),
		avgRating: ratingWeight > 0 ? Math.round((ratingSum / ratingWeight) * 10) / 10 : 0,
		trend: trendMinor.map((m) => toWhole(m, target)),
	};
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
	const all = loaded.listings.map((l) => summaryOf(loaded, l, owner, allTime, convert));

	let items = all.slice();
	if (params.type && params.type !== "all") items = items.filter((d) => d.kind === params.type);
	if (params.status) items = items.filter((d) => d.status === params.status);
	if (params.model) items = items.filter((d) => d.serviceType === params.model);
	if (params.needsAttention) items = items.filter((d) => d.needsAttention);
	if (params.promoted) items = items.filter((d) => d.promoted);
	if (params.search) {
		const q = params.search.toLowerCase();
		items = items.filter((d) => d.title.toLowerCase().includes(q) || d.category.toLowerCase().includes(q));
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
	const pageItems = items.slice(start, start + limit);

	const counts = { draft: 0, published: 0, paused: 0, archived: 0 };
	for (const d of all) counts[d.status]++;

	const live = loaded.listings.filter((l) =>
		l.status !== "archived" && (!params.type || params.type === "all" || l.kind === params.type)
	);
	return {
		items: pageItems,
		hasMore: start + limit < total,
		nextCursor: start + limit < total ? pageItems[pageItems.length - 1]?.id ?? null : null,
		total,
		statusCounts: counts,
		stats: await statsFor(db, live, loaded, params.period ?? "30d", display),
		viewerId: owner.handle,
	};
}
// #endregion

// #region Detail
/** The listing row a console address (`svc-…` / `prd-…`) names, if the caller can see it. */
async function listingBySlug(db: SupabaseClient, slug: string): Promise<ListingRow | null> {
	const isService = slug.startsWith("svc-");
	const isProduct = slug.startsWith("prd-");
	if (!isService && !isProduct) return null;
	const { data: subject, error } = await (isService
		? db.schema("marketplace").from("service_blueprints").select("id").eq("slug", slug).maybeSingle()
		: db.schema("catalogue").from("products").select("id").eq("slug", slug).maybeSingle());
	if (error) throw new Error(`listing subject read failed: ${error.message}`);
	if (!subject) return null;
	const { data, error: listingError } = await db.schema("catalogue").from("listings").select(LISTING_COLUMNS)
		.eq(isService ? "service_blueprint_id" : "product_id", (subject as { id: string }).id)
		.maybeSingle();
	if (listingError) throw new Error(`catalogue.listings read failed: ${listingError.message}`);
	if (!data) return null;
	const l = data as ListingRow;
	return { ...l, amount_cents: Number(l.amount_cents) || 0, view_count: Number(l.view_count) || 0, currency: (l.currency ?? "USD").toUpperCase() };
}

/** A console listing is the caller's own (or their team's); anybody else's is not theirs to manage. */
function ownsListing(l: ListingRow, actor: ReadActor): boolean {
	if (l.owner_team_id) return actor.contextType === "team" ? actor.contextId === l.owner_team_id : l.owner_user_id === actor.userId;
	return l.owner_user_id === actor.userId;
}

/** One listing's full editable detail, or `null` when it is not the caller's to manage. */
export async function listingDetail(slug: string, actor: ReadActor & { accessToken: string }): Promise<ListingDetail | null> {
	const db = getUserClient(actor.accessToken);
	const l = await listingBySlug(db, slug);
	if (!l || !ownsListing(l, actor)) return null;

	const scope: Scope = { userId: l.owner_user_id, teamId: l.owner_team_id };
	const [loaded, owner, skills, tags, availability, collections, sales] = await Promise.all([
		withChildren(db, [l]),
		ownerFor(scope),
		db.schema("catalogue").from("listing_skills").select("skill_id").eq("listing_id", l.id),
		db.schema("catalogue").from("listing_tags").select("tag").eq("listing_id", l.id),
		db.schema("catalogue").from("listing_availability")
			.select("timezone, weekdays, start_hour, end_hour, note").eq("listing_id", l.id).maybeSingle(),
		db.schema("catalogue").from("collection_listings").select("collection_id").eq("listing_id", l.id),
		salesFor(db, [l.id], null),
	]);
	for (const r of [skills, tags, availability, collections]) {
		if (r.error) throw new Error(`listing detail read failed: ${r.error.message}`);
	}

	const skillIds = ((skills.data ?? []) as Array<{ skill_id: string }>).map((s) => s.skill_id);
	const collectionIds = ((collections.data ?? []) as Array<{ collection_id: string }>).map((c) => c.collection_id);
	const [skillRows, collectionRows] = await Promise.all([
		skillIds.length
			? db.schema("org").from("skills").select("id, label").in("id", skillIds)
			: Promise.resolve({ data: [], error: null }),
		collectionIds.length
			? db.schema("catalogue").from("collections").select("id, name").in("id", collectionIds)
			: Promise.resolve({ data: [], error: null }),
	]);

	const convert = await converter([l], sales);
	const summary = summaryOf(loaded, l, owner, sales, convert);
	const subject = subjectOf(loaded, l);
	const avail = availability.data as
		| { timezone: string; weekdays: number[]; start_hour: number; end_hour: number; note: string }
		| null;
	const intake = IntakeFieldSchema.array().safeParse(subject?.intake_fields ?? []);
	const skillRefs: SkillRef[] = ((skillRows.data ?? []) as Array<{ label: string }>).map((s) => resolveSkill(s.label));

	return {
		...summary,
		owner,
		description: l.description?.html ?? "",
		descriptionText: l.description_text,
		media: galleryOf(loaded, l),
		skills: skillRefs,
		tags: ((tags.data ?? []) as Array<{ tag: string }>).map((t) => t.tag),
		pricing: pricingOf(l),
		delivery: l.delivery_label,
		availability: avail
			? {
				timezone: avail.timezone,
				weekdays: avail.weekdays ?? [],
				startHour: avail.start_hour,
				endHour: avail.end_hour,
				note: avail.note ?? "",
			}
			: null,
		collections: ((collectionRows.data ?? []) as Array<{ name: string }>).map((c) => c.name),
		intake: l.kind === "service" && intake.success ? intake.data : [],
	};
}
// #endregion

// #region Writes
/** The PostgREST error a door raised, as a refusal with its own sentence. */
function refusalOf<T>(error: { code?: string; message: string; details?: string | null }): Result<T> {
	const status = statusFor(error.code);
	const message = error.message.replace(/\s+/g, " ").trim().slice(0, 200) || "That didn't save.";
	if (error.code === "PG422") {
		return refuse(422, message, { publish: (error.details ?? "").split("|").filter(Boolean).join(", ") });
	}
	if (status === 503) throw new Error(message);
	return refuse(status, message);
}

/** Create a draft listing and route to its manage page. */
export async function createListing(
	input: CreateListingInput,
	actor: ReadActor & { accessToken: string },
): Promise<Result<{ listing: ListingDetail }>> {
	const db = getUserClient(actor.accessToken);
	const scope = scopeOf(actor);
	const { data, error } = await db.schema("catalogue").rpc("create_listing", {
		p_kind: input.kind,
		p_title: input.title,
		p_delivery_model: input.kind === "service" && input.serviceType ? MODEL_TO_DB[input.serviceType] : null,
		p_team: scope.teamId,
	});
	if (error) return refusalOf(error);
	const slug = (data as { slug?: string } | null)?.slug;
	const listing = slug ? await listingDetail(slug, actor) : null;
	if (!listing) throw new Error("The new listing could not be read back.");
	return ok({ listing }, { status: 201, message: "Draft created." }) as Result<{ listing: ListingDetail }>;
}

/**
 * Resolve the editor's gallery (URLs, as the page shows them) back to stored references: a public
 * object of this project becomes its `files.items` row, anything else stays a link.
 */
async function mediaEntries(db: SupabaseClient, urls: readonly string[]): Promise<Array<{ file_id?: string; url?: string }>> {
	const parsed = urls.map((url) => ({ url, ref: parsePublicObjectUrl(url) }));
	const byObject = new Map<string, string>();
	const refs = parsed.flatMap((p) => p.ref ? [p.ref] : []);
	for (const bucket of new Set(refs.map((r) => r.bucket))) {
		const paths = refs.filter((r) => r.bucket === bucket).map((r) => r.path);
		const { data, error } = await db.schema("files").from("items")
			.select("id, bucket_id, storage_path").eq("bucket_id", bucket).in("storage_path", paths).is("deleted_at", null);
		if (error) throw new Error(`files.items read failed: ${error.message}`);
		for (const f of (data ?? []) as Array<{ id: string; bucket_id: string; storage_path: string }>) {
			byObject.set(`${f.bucket_id}/${f.storage_path}`, f.id);
		}
	}
	return parsed.map((p) => {
		const id = p.ref ? byObject.get(`${p.ref.bucket}/${p.ref.path}`) : undefined;
		return id ? { file_id: id } : { url: p.url };
	});
}

/** Apply an editor patch to a listing (and its product or blueprint), then read it back. */
export async function updateListing(
	patch: UpdateListingInput,
	actor: ReadActor & { accessToken: string },
): Promise<Result<{ listing: ListingDetail }>> {
	const db = getUserClient(actor.accessToken);
	const l = await listingBySlug(db, patch.id);
	if (!l || !ownsListing(l, actor)) return refuse(404, "No such listing.");
	const currency = l.currency;
	const minor = (whole: number | null | undefined) => whole === null || whole === undefined ? null : toMinorUnits(whole, currency);

	const body: Record<string, unknown> = {};
	if (patch.title !== undefined) body.title = patch.title;
	if (patch.category !== undefined) body.category = patch.category;
	if (patch.description !== undefined) {
		body.description_html = patch.description;
		// The searchable twin is derived here from the HTML, never taken on trust from the page.
		body.description_text = flattenRichText(patch.description).slice(0, 4000);
	} else if (patch.descriptionText !== undefined) {
		body.description_text = patch.descriptionText;
	}
	if (patch.delivery !== undefined) body.delivery_label = patch.delivery;
	if (patch.pricing !== undefined) {
		body.amount_cents = minor(patch.pricing.amount) ?? 0;
		body.ticket_price_cents = minor(patch.pricing.ticketPrice);
		body.session_price_cents = minor(patch.pricing.sessionPrice);
		body.seats_per_session = patch.pricing.seatsPerSession;
		body.free_revisions = patch.pricing.freeRevisions;
		body.extra_revision_price_cents = minor(patch.pricing.extraRevisionPrice);
	}
	if (patch.serviceType !== undefined && l.kind === "service") body.delivery_model = MODEL_TO_DB[patch.serviceType];
	if (patch.intake !== undefined && l.kind === "service") body.intake = patch.intake as IntakeField[];
	if (patch.media !== undefined) body.media = await mediaEntries(db, patch.media);
	if (patch.skills !== undefined) body.skills = patch.skills.map((s) => s.label);
	if (patch.tags !== undefined) body.tags = patch.tags;
	if (patch.collections !== undefined) body.collections = patch.collections;
	if (patch.availability !== undefined) {
		body.availability = patch.availability === null ? null : availabilityBody(patch.availability);
	}

	const { error } = await db.schema("catalogue").rpc("save_listing", { p_listing: l.id, p_patch: body });
	if (error) return refusalOf(error);
	const listing = await listingDetail(patch.id, actor);
	if (!listing) throw new Error("The saved listing could not be read back.");
	return ok({ listing }, { message: "Saved." }) as Result<{ listing: ListingDetail }>;
}

function availabilityBody(a: ListingAvailability) {
	return {
		timezone: a.timezone,
		weekdays: a.weekdays,
		start_hour: a.startHour,
		end_hour: a.endHour,
		note: a.note,
	};
}

/** Move a listing through its lifecycle; publishing passes the gate server-side. */
export async function setListingStatus(
	input: SetListingStatusInput,
	actor: ReadActor & { accessToken: string },
): Promise<Result<{ listing: ListingDetail }>> {
	const db = getUserClient(actor.accessToken);
	const l = await listingBySlug(db, input.id);
	if (!l || !ownsListing(l, actor)) return refuse(404, "No such listing.");
	const { error } = await db.schema("catalogue").rpc("set_listing_status", {
		p_listing: l.id,
		p_status: input.status,
	});
	if (error) return refusalOf(error);
	const listing = await listingDetail(input.id, actor);
	if (!listing) throw new Error("The listing could not be read back.");
	return ok({ listing }, { message: statusMessage(input.status) }) as Result<{ listing: ListingDetail }>;
}

function statusMessage(status: ListingStatus): string {
	switch (status) {
		case "published":
			return "Listing published.";
		case "paused":
			return "Listing paused.";
		case "archived":
			return "Listing archived.";
		case "draft":
			return "Listing moved to drafts.";
	}
}
// #endregion
