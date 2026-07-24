import type { LaneTabOption } from "@projective/ui/navigation";
import type { ProductItem, ServiceItem } from "@projective/types/explore";
import type { UserContext } from "@projective/types/auth";
import type {
	CatalogueSort,
	CatalogueTypeFilter,
	ListingDetail,
	ListingStatus,
} from "../types/catalogue-types.ts";

/** Whether the acting context can offer/sell (freelancer or a team context) — the seller predicate. */
export function isSeller(context: UserContext): boolean {
	return context.isFreelancer || context.contextType === "team";
}

/**
 * catalogue-model — the pure, presentation-agnostic helpers the Catalogue islands share: route hrefs,
 * status metadata, the type/sort/model option vocabularies, and the live-preview item builder that
 * reconstructs a discovery {@link ServiceItem}/{@link ProductItem} from an edited listing so the manage
 * page can render the REAL `ServiceCard`/`ProductCard`. No state, no DOM — safe to import anywhere.
 */

// #region Route hrefs
/** The manage page for a listing. */
export function listingHref(id: string): string {
	return `/catalogue/${id}`;
}

/** The public Entity View for a listing (the "View public page" link). */
export function publicListingHref(detail: Pick<ListingDetail, "id" | "kind">): string {
	return `/view/${detail.id}?type=${detail.kind === "service" ? "services" : "products"}`;
}

/** The console URL for a type segment (`?type=` — `all` drops the param). */
export function segmentHref(type: CatalogueTypeFilter): string {
	return type === "all" ? "/catalogue" : `/catalogue?type=${type}`;
}
// #endregion

// #region Status metadata
/** A status's display label + tonal key (drives the chip's `data-tone` in `catalogue.css`). */
export interface StatusMeta {
	label: string;
	tone: "success" | "neutral" | "warning" | "muted";
}

/** Resolve a listing status to its label + tonal key. */
export function statusMeta(status: ListingStatus): StatusMeta {
	switch (status) {
		case "published":
			return { label: "Published", tone: "success" };
		case "draft":
			return { label: "Draft", tone: "neutral" };
		case "paused":
			return { label: "Paused", tone: "warning" };
		case "archived":
			return { label: "Archived", tone: "muted" };
	}
}

/** The lane's status sections, in display order. */
export const STATUS_SECTIONS: readonly { status: ListingStatus; label: string }[] = [
	{ status: "published", label: "Published" },
	{ status: "draft", label: "Drafts" },
	{ status: "paused", label: "Paused" },
	{ status: "archived", label: "Archived" },
];
// #endregion

// #region Vocabularies
/** The console + lane type segments. */
export const TYPE_TABS: readonly LaneTabOption<CatalogueTypeFilter>[] = [
	{ value: "all", label: "All" },
	{ value: "product", label: "Products" },
	{ value: "service", label: "Services" },
];

/** A minimal `{ value, label }` shape assignable to both `Select`'s `Option` and `SortControl`'s
 * `SortOption` (neither carries an `icon`, avoiding their conflicting `icon` types). */
export interface PickOption {
	value: string;
	label: string;
}

/** The console sort options (drives the `SortControl` property dropdown). */
export const SORT_OPTIONS: readonly PickOption[] = [
	{ label: "Recently edited", value: "recent" },
	{ label: "Best-selling", value: "best-selling" },
	{ label: "Price", value: "price" },
	{ label: "Rating", value: "rating" },
	{ label: "Status", value: "status" },
];

/** The five service delivery models (the Services model filter + the create-modal picker). */
export const MODEL_OPTIONS: readonly PickOption[] = [
	{ label: "Pipeline", value: "Pipeline" },
	{ label: "One-Off", value: "One-Off" },
	{ label: "Direct Deliverable", value: "Direct Deliverable" },
	{ label: "Session", value: "Session" },
	{ label: "Group Session", value: "Group Session" },
];

/** Singular noun for a kind ("product" / "service"). */
export function kindNoun(kind: "product" | "service"): string {
	return kind === "service" ? "service" : "product";
}

/** Coerce a raw string to a valid sort key, else `recent`. */
export function toSort(raw: string | null): CatalogueSort {
	const ok: CatalogueSort[] = ["recent", "best-selling", "price", "rating", "status"];
	return ok.includes(raw as CatalogueSort) ? (raw as CatalogueSort) : "recent";
}

/** The natural direction a sort key reads in — recent/best-selling/rating desc, price/status asc. */
export function defaultSortDir(sort: CatalogueSort): "asc" | "desc" {
	return sort === "recent" || sort === "best-selling" || sort === "rating" ? "desc" : "asc";
}

/** Coerce a raw string to a valid type segment, else `all`. */
export function toTypeFilter(raw: string | null): CatalogueTypeFilter {
	return raw === "product" || raw === "service" ? raw : "all";
}
// #endregion

// #region Live-preview item builder
/**
 * Reconstruct a discovery {@link ServiceItem}/{@link ProductItem} from an edited listing so the manage
 * page can render the REAL explore card. The card reads only a handful of fields (title, owner, media,
 * the pricing pair, delivery, category, serviceType) — the rest are inert placeholders required by the
 * discovery schema (`skills`/`summary`/`createdAt`). The pricing display string is the already-resolved
 * projection (`detail.price.display`), so the card's fixed-price fallback matches the console + `/view`.
 */
export function buildPreviewItem(detail: ListingDetail): ServiceItem | ProductItem {
	const rating = detail.metrics.avgRating > 0
		? { asHelper: { value: detail.metrics.avgRating, count: detail.metrics.ratingCount } }
		: undefined;
	const cover = detail.media[0];
	if (detail.kind === "service") {
		return {
			id: detail.id,
			type: "services",
			title: detail.title || "Untitled service",
			owner: detail.owner,
			skills: detail.skills,
			summary: detail.descriptionText,
			media: cover,
			sponsored: detail.promoted,
			createdAt: detail.updatedAt,
			price: detail.price.display,
			delivery: detail.delivery || "Delivery TBD",
			category: detail.category,
			serviceType: detail.serviceType ?? "One-Off",
			ticketPrice: detail.pricing.ticketPrice ?? undefined,
			sessionPrice: detail.pricing.sessionPrice ?? undefined,
			rating,
		};
	}
	return {
		id: detail.id,
		type: "products",
		title: detail.title || "Untitled product",
		owner: detail.owner,
		skills: detail.skills,
		summary: detail.descriptionText,
		media: cover,
		sponsored: detail.promoted,
		createdAt: detail.updatedAt,
		price: detail.price.display,
		category: detail.category || "product",
		span: 2,
		rating,
	};
}
// #endregion
