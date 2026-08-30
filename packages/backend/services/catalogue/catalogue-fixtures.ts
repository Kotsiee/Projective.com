import type {
	CatalogueListParams,
	CataloguePage,
	CatalogueStats,
	CreateListingInput,
	ListingAvailability,
	ListingDetail,
	ListingMetrics,
	ListingStatus,
	ListingSummary,
	SetListingStatusInput,
	UpdateListingInput,
} from "@projective/types/catalogue";
import { money, publishReadiness, resolveListingPricing } from "@projective/types/catalogue";
import type { ExploreOwner, ProductItem, ServiceItem } from "@projective/types/explore";
import { PRODUCTS, SERVICES } from "../explore/fixtures.ts";
import { mockAvatar } from "../../mocks/assets.ts";

/**
 * catalogue fixtures — the fat {@link CatalogueBackendService}'s in-memory answer for the seller
 * `/catalogue` reads AND the stub write path (create / update / publish) while `CATALOGUE_BACKEND_LIVE`
 * is off (thin-frontend pattern, root CLAUDE.md §10). Like the sibling read projections it DERIVES a
 * deterministic catalogue from the existing discovery corpus (`../explore/fixtures.ts` `SERVICES` +
 * `PRODUCTS`), **re-owned to a single acting seller**, so every listing agrees on identity/content with
 * the `ServiceCard`/`ProductCard` and the public `/view/[id]` it links to (same id, same title, price,
 * media, delivery model). No RNG — a stable id hash seeds the variation and a fixed reference clock
 * keeps SSR and the island's refetch identical.
 *
 * Because this is the platform's first WRITE surface, the derived listings are seeded into a mutable
 * module-level {@link STORE} so the create→edit→publish flow is fully exercisable with the gate off:
 * `createListing` mints an optimistic draft, `updateListing` merges a patch, `setStatus` runs the
 * publish gate. It grants no persistence (the store is per-process, cleared on restart); the RLS-scoped
 * `catalogue.*` tables + mutation policies replace it behind the same gate with zero shape churn.
 *
 * **Fixtures-only divergence (flagged, root CLAUDE.md §8):** the whole services+products corpus is
 * re-owned to one acting seller for a populated demo catalogue, so a listing's preview shows that
 * seller while the untouched public `/view/[id]` still shows the corpus's original owner. The live
 * `catalogue.*` path unifies them; the substantive fields (title/price/media/model) already agree.
 */

// #region Reference clock + deterministic helpers (declared before STORE — it builds at module init)
/** Fixed reference "now" (no `Date.now()`), matching the sibling fixtures. */
const NOW = Date.parse("2026-07-17T16:20:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A tiny stable hash → non-negative int (no RNG; SSR/resume stable). Unsigned `>>>` per the docs. */
function hash(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
	return h;
}

/** Round to one decimal place. */
function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

/** `Edited today` / `Edited 2 days ago` relative to {@link NOW} (UTC day math). */
function fmtEdited(ms: number): string {
	const diff = Math.floor(NOW / DAY) - Math.floor(ms / DAY);
	if (diff <= 0) return "Edited today";
	if (diff === 1) return "Edited yesterday";
	if (diff < 7) return `Edited ${diff} days ago`;
	const weeks = Math.round(diff / 7);
	return weeks <= 1 ? "Edited last week" : `Edited ${weeks} weeks ago`;
}

/** Parse a display price string ("$4,800") to a whole-number amount. */
function parsePrice(s: string): number {
	return Number(s.replace(/[^0-9.]/g, "")) || 0;
}

/** The acting seller every fixture listing is re-owned to (a fixed identity, like the messaging cast). */
const ACTING_SELLER: ExploreOwner = {
	handle: "@ahmed",
	name: "Ahmed K.",
	avatar:
		mockAvatar("photo-1506794778202-cad84cf45f1d", 160),
	kind: "freelancer",
	verified: true,
};

/** The default weekly availability seeded for Session / Group Session listings. */
function defaultAvailability(): ListingAvailability {
	return {
		timezone: "UTC",
		weekdays: [1, 2, 3, 4, 5],
		startHour: 9,
		endHour: 17,
		note: "Booked in 60-minute blocks · 48h notice",
	};
}
// #endregion

// #region Status assignment + metrics
const STATUS_ORDER: readonly ListingStatus[] = ["published", "draft", "paused", "archived"];

/**
 * Deterministically spread the corpus across all four lifecycle states so every lane section + the KPI
 * strip have content (and each status is verifiable). A promoted listing is always `published` (a
 * promotion implies it is live).
 */
function statusFor(index: number, promoted: boolean): ListingStatus {
	if (promoted) return "published";
	switch (index % 6) {
		case 3:
			return "draft";
		case 4:
			return "paused";
		case 5:
			return "archived";
		default:
			return "published";
	}
}

/** Derive light analytics from the id hash, scaled down for non-live states. */
function metricsFor(id: string, status: ListingStatus): ListingMetrics {
	const h = hash(id);
	const scale = status === "published"
		? 1
		: status === "paused"
		? 0.5
		: status === "archived"
		? 0.3
		: 0.12;
	const views30d = Math.round(((h % 900) + 80) * scale);
	const orders = Math.round(((h >>> 3) % 42) * scale);
	const revenue = orders * (((h >>> 5) % 380) + 60);
	const rated = status !== "draft" && ratingCountRaw(h) > 0;
	return {
		views30d,
		orders,
		revenue,
		revenueLabel: money(revenue),
		avgRating: rated ? round1(4 + (h % 10) / 10) : 0,
		ratingCount: rated ? ratingCountRaw(h) : 0,
		trend: Array.from({ length: 8 }, (_, i) => Math.round((hash(`${id}:${i}`) % 100) * scale)),
	};
}

function ratingCountRaw(h: number): number {
	return (h >>> 7) % 64;
}
// #endregion

// #region Derive a ListingDetail from a corpus item
function serviceToDetail(item: ServiceItem, index: number): ListingDetail {
	const status = statusFor(index, item.sponsored ?? false);
	const pricing = {
		amount: parsePrice(item.price),
		ticketPrice: item.ticketPrice ?? null,
		sessionPrice: item.sessionPrice ?? null,
		seatsPerSession: item.serviceType === "Group Session" ? 8 : null,
		freeRevisions: item.freeRevisions ?? null,
		extraRevisionPrice: item.extraRevisionPrice ?? null,
	};
	const media = item.media ? [item.media] : [];
	const summary: ListingSummary = {
		id: item.id,
		ownerId: ACTING_SELLER.handle,
		kind: "service",
		serviceType: item.serviceType,
		title: item.title,
		category: item.category,
		status,
		cover: media[0] ?? null,
		price: resolveListingPricing({ kind: "service", serviceType: item.serviceType, pricing }),
		metrics: metricsFor(item.id, status),
		updatedAt: new Date(NOW - (hash(item.id) % 26) * DAY - (hash(item.id) % 12) * HOUR)
			.toISOString(),
		updatedLabel: fmtEdited(NOW - (hash(item.id) % 26) * DAY),
		promoted: item.sponsored ?? false,
		needsAttention: false,
	};
	const detail: ListingDetail = {
		...summary,
		owner: ACTING_SELLER,
		description: `<p>${item.summary}</p>`,
		descriptionText: item.summary,
		media,
		skills: item.skills,
		tags: dedupeTags([item.category, ...item.skills.map((s) => s.label)]),
		pricing,
		delivery: item.delivery,
		availability: item.serviceType === "Session" || item.serviceType === "Group Session"
			? defaultAvailability()
			: null,
		collections: [],
	};
	detail.needsAttention = needsAttentionFor(detail);
	summary.needsAttention = detail.needsAttention;
	return detail;
}

function productToDetail(item: ProductItem, index: number): ListingDetail {
	const status = statusFor(index, item.sponsored ?? false);
	const pricing = {
		amount: parsePrice(item.price),
		ticketPrice: null,
		sessionPrice: null,
		seatsPerSession: null,
		freeRevisions: null,
		extraRevisionPrice: null,
	};
	const media = item.media ? [item.media] : [];
	const summary: ListingSummary = {
		id: item.id,
		ownerId: ACTING_SELLER.handle,
		kind: "product",
		serviceType: null,
		title: item.title,
		category: item.category,
		status,
		cover: media[0] ?? null,
		price: resolveListingPricing({ kind: "product", serviceType: null, pricing }),
		metrics: metricsFor(item.id, status),
		updatedAt: new Date(NOW - (hash(item.id) % 26) * DAY - (hash(item.id) % 12) * HOUR)
			.toISOString(),
		updatedLabel: fmtEdited(NOW - (hash(item.id) % 26) * DAY),
		promoted: item.sponsored ?? false,
		needsAttention: false,
	};
	const detail: ListingDetail = {
		...summary,
		owner: ACTING_SELLER,
		description: `<p>${item.summary}</p>`,
		descriptionText: item.summary,
		media,
		skills: item.skills,
		tags: dedupeTags([item.category, ...item.skills.map((s) => s.label)]),
		pricing,
		delivery: "Instant download",
		availability: null,
		collections: [],
	};
	detail.needsAttention = needsAttentionFor(detail);
	summary.needsAttention = detail.needsAttention;
	return detail;
}

/** Whether a listing wants the seller's eye — an unready draft, or a deterministic subset of live ones. */
function needsAttentionFor(detail: ListingDetail): boolean {
	if (detail.status === "draft") return !publishReadiness(detail).ready;
	if (detail.status === "published") return hash(detail.id) % 11 === 0;
	return false;
}

function dedupeTags(tags: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of tags) {
		const key = t.toLowerCase();
		if (t && !seen.has(key)) {
			seen.add(key);
			out.push(t);
		}
	}
	return out.slice(0, 6);
}
// #endregion

// #region Mutable session store (seeded from the corpus)
/** The acting seller's catalogue, keyed by listing id. Order preserved via {@link ORDER}. */
const STORE = new Map<string, ListingDetail>();
const ORDER: string[] = [];

let seq = 0;

(function seed(): void {
	SERVICES.forEach((s, i) => {
		const d = serviceToDetail(s, i);
		STORE.set(d.id, d);
		ORDER.push(d.id);
	});
	PRODUCTS.forEach((p, i) => {
		// Continue the index sequence past the services so the status spread stays varied.
		const d = productToDetail(p, i + SERVICES.length);
		STORE.set(d.id, d);
		ORDER.push(d.id);
	});
})();

/** The listings in stable insertion order (created listings append at the front — newest first). */
function allListings(): ListingDetail[] {
	return ORDER.map((id) => STORE.get(id)!).filter(Boolean);
}
// #endregion

// #region Read: list + detail + stats
/** The numeric sort key for the `price` sort (the per-unit figure, else the fixed amount). */
function priceValue(d: ListingDetail): number {
	if (d.kind === "service" && d.serviceType === "Pipeline" && d.pricing.ticketPrice) {
		return d.pricing.ticketPrice;
	}
	if (
		d.kind === "service" && (d.serviceType === "Session" || d.serviceType === "Group Session") &&
		d.pricing.sessionPrice
	) {
		return d.pricing.sessionPrice;
	}
	return d.pricing.amount;
}

/** The ascending comparator for a sort key; the caller flips it by direction. */
function ascCompare(sort: CatalogueListParams["sort"], a: ListingDetail, b: ListingDetail): number {
	switch (sort) {
		case "title":
			// Numeric-aware + case-insensitive, so "Iconography set — 640" files where a reader expects.
			return a.title.localeCompare(b.title, "en", { numeric: true, sensitivity: "base" });
		case "best-selling":
			return a.metrics.orders - b.metrics.orders;
		case "views":
			return a.metrics.views30d - b.metrics.views30d;
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

function statusCounts(list: ListingDetail[]) {
	const counts = { draft: 0, published: 0, paused: 0, archived: 0 };
	for (const d of list) counts[d.status]++;
	return counts;
}

/**
 * Roll up the KPI strip over every non-archived listing **in the active type scope**.
 *
 * The scope argument is deliberate. A type segment is a scope the seller chose and stays in, so the
 * analytics must follow it — reporting the whole catalogue while the console shows only Services made
 * the two disagree on screen. A *search* is not a scope: it is a lookup, and "revenue across listings
 * matching 'brand'" answers no question a seller has. So the strip follows the segment, ignores the
 * query, and the console labels which of the two it is reporting.
 */
function computeStats(type?: CatalogueListParams["type"]): CatalogueStats {
	const live = allListings().filter((d) =>
		d.status !== "archived" && (!type || type === "all" || d.kind === type)
	);
	let views30d = 0, orders = 0, revenue = 0, ratingSum = 0, ratingWeight = 0;
	const trend = Array(8).fill(0);
	for (const d of live) {
		views30d += d.metrics.views30d;
		orders += d.metrics.orders;
		revenue += d.metrics.revenue;
		if (d.metrics.ratingCount > 0) {
			ratingSum += d.metrics.avgRating * d.metrics.ratingCount;
			ratingWeight += d.metrics.ratingCount;
		}
		d.metrics.trend.forEach((v, i) => (trend[i] += v));
	}
	return {
		activeListings: live.filter((d) => d.status === "published").length,
		totalListings: live.length,
		views30d,
		orders,
		revenue,
		revenueLabel: money(revenue),
		avgRating: ratingWeight > 0 ? round1(ratingSum / ratingWeight) : 0,
		trend,
	};
}

/** Filter + sort + page the catalogue for the console / lane. */
export function listListings(params: CatalogueListParams): CataloguePage {
	const all = allListings();
	let items = all.slice();

	if (params.type && params.type !== "all") items = items.filter((d) => d.kind === params.type);
	if (params.status) items = items.filter((d) => d.status === params.status);
	if (params.model) items = items.filter((d) => d.serviceType === params.model);
	if (params.needsAttention) items = items.filter((d) => d.needsAttention);
	if (params.promoted) items = items.filter((d) => d.promoted);
	if (params.search) {
		const q = params.search.toLowerCase();
		items = items.filter((d) =>
			d.title.toLowerCase().includes(q) ||
			d.category.toLowerCase().includes(q) ||
			d.tags.some((t) => t.toLowerCase().includes(q))
		);
	}

	const sort = params.sort ?? "recent";
	// These keys read most-natural DESC (newest / best-selling / highest-rated first); the SortControl
	// direction can flip any of them. Price + Status read ASC by default.
	const defaultDesc = sort === "recent" || sort === "best-selling" || sort === "rating";
	const dir = params.dir ?? (defaultDesc ? "desc" : "asc");
	items.sort((a, b) => {
		const c = ascCompare(sort, a, b);
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
	const nextCursor = start + limit < total ? pageItems[pageItems.length - 1]?.id ?? null : null;

	return {
		items: pageItems.map(toSummary),
		hasMore: start + limit < total,
		nextCursor,
		total,
		statusCounts: statusCounts(all),
		stats: computeStats(params.type),
		viewerId: ACTING_SELLER.handle,
	};
}

/** Project a detail down to the list summary. */
function toSummary(d: ListingDetail): ListingSummary {
	return {
		id: d.id,
		ownerId: d.ownerId,
		kind: d.kind,
		serviceType: d.serviceType,
		title: d.title,
		category: d.category,
		status: d.status,
		cover: d.cover,
		price: d.price,
		metrics: d.metrics,
		updatedAt: d.updatedAt,
		updatedLabel: d.updatedLabel,
		promoted: d.promoted,
		needsAttention: d.needsAttention,
	};
}

/** A single listing's full editable detail, or null. */
export function findListing(id: string): ListingDetail | null {
	return STORE.get(id) ?? null;
}
// #endregion

// #region Write: create / update / setStatus (stub — mutates the session store)
/** Mint a new Draft listing from the create modal's minimal fields and store it (newest-first). */
export function createListing(input: CreateListingInput): ListingDetail {
	const id = `cl-${++seq}`;
	const serviceType = input.kind === "service" ? input.serviceType ?? "One-Off" : null;
	const pricing = {
		amount: 0,
		ticketPrice: null,
		sessionPrice: null,
		seatsPerSession: null,
		freeRevisions: null,
		extraRevisionPrice: null,
	};
	const detail: ListingDetail = {
		id,
		ownerId: ACTING_SELLER.handle,
		kind: input.kind,
		serviceType,
		title: input.title.trim(),
		category: "",
		status: "draft",
		cover: null,
		price: resolveListingPricing({ kind: input.kind, serviceType, pricing }),
		metrics: metricsFor(id, "draft"),
		updatedAt: new Date(NOW).toISOString(),
		updatedLabel: "Edited just now",
		promoted: false,
		needsAttention: true,
		owner: ACTING_SELLER,
		description: "",
		descriptionText: "",
		media: [],
		skills: [],
		tags: [],
		pricing,
		delivery: input.kind === "product" ? "Instant download" : "",
		availability: serviceType === "Session" || serviceType === "Group Session"
			? defaultAvailability()
			: null,
		collections: [],
	};
	STORE.set(id, detail);
	ORDER.unshift(id);
	return detail;
}

/** Merge an editable patch over a stored listing; recompute the derived price/cover/attention. */
export function updateListing(patch: UpdateListingInput): ListingDetail | null {
	const current = STORE.get(patch.id);
	if (!current) return null;
	const serviceType = patch.serviceType !== undefined
		? (current.kind === "service" ? patch.serviceType : null)
		: current.serviceType;
	const pricing = patch.pricing ?? current.pricing;
	const media = patch.media ?? current.media;
	const next: ListingDetail = {
		...current,
		serviceType,
		title: patch.title ?? current.title,
		category: patch.category ?? current.category,
		description: patch.description ?? current.description,
		descriptionText: patch.descriptionText ?? current.descriptionText,
		media,
		skills: patch.skills ?? current.skills,
		tags: patch.tags ?? current.tags,
		pricing,
		delivery: patch.delivery ?? current.delivery,
		availability: patch.availability !== undefined ? patch.availability : current.availability,
		collections: patch.collections ?? current.collections,
		cover: media[0] ?? null,
		price: resolveListingPricing({ kind: current.kind, serviceType, pricing }),
		updatedAt: new Date(NOW).toISOString(),
		updatedLabel: "Edited just now",
	};
	next.needsAttention = needsAttentionFor(next);
	STORE.set(patch.id, next);
	return next;
}

/** The outcome of a status transition — success, missing listing, or a blocked publish gate. */
export interface StatusResult {
	detail: ListingDetail | null;
	/** Set when a publish was blocked by the gate — the human list of what is missing. */
	blocked?: string[];
}

/** Transition a listing's lifecycle state; a `published` transition runs the publish gate. */
export function setListingStatus(input: SetListingStatusInput): StatusResult {
	const current = STORE.get(input.id);
	if (!current) return { detail: null };
	if (input.status === "published") {
		const gate = publishReadiness(current);
		if (!gate.ready) return { detail: null, blocked: gate.missing };
	}
	const next: ListingDetail = {
		...current,
		status: input.status,
		updatedAt: new Date(NOW).toISOString(),
		updatedLabel: "Edited just now",
	};
	next.needsAttention = needsAttentionFor(next);
	STORE.set(input.id, next);
	return { detail: next };
}
// #endregion
