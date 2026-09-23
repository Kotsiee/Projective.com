import type { ProductItem, ServiceItem } from "@projective/types/explore";
import type { UserContext } from "@projective/types/auth";
import { toMinorUnits } from "@projective/types/finance";
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
/**
 * The console + lane type segments. Declared as the plain `{ value, label }` shape the lane's
 * `LaneTabs` takes rather than importing its type: that import drags the navigation package's
 * stylesheets into this module's graph, and this module is meant to be importable anywhere —
 * a test included.
 */
export const TYPE_TABS: readonly { value: CatalogueTypeFilter; label: string }[] = [
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

/** The console sort options (drives the footer rig's `SortControl` property dropdown). */
export const SORT_OPTIONS: readonly PickOption[] = [
	{ label: "Recently edited", value: "recent" },
	{ label: "Name", value: "title" },
	{ label: "Status", value: "status" },
	{ label: "Price", value: "price" },
	{ label: "Views", value: "views" },
	{ label: "Best-selling", value: "best-selling" },
	{ label: "Rating", value: "rating" },
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
	const ok: CatalogueSort[] = [
		"recent",
		"title",
		"best-selling",
		"views",
		"price",
		"rating",
		"status",
	];
	return ok.includes(raw as CatalogueSort) ? (raw as CatalogueSort) : "recent";
}

/**
 * The direction a sort key reads most naturally in first. Magnitudes open at their largest (newest,
 * best-selling, most-viewed, highest-rated); a name and a lifecycle read forwards.
 */
export function defaultSortDir(sort: CatalogueSort): "asc" | "desc" {
	return sort === "recent" || sort === "best-selling" || sort === "views" || sort === "rating"
		? "desc"
		: "asc";
}

/** Coerce a raw string to a valid type segment, else `all`. */
export function toTypeFilter(raw: string | null): CatalogueTypeFilter {
	return raw === "product" || raw === "service" ? raw : "all";
}
// #endregion

// #region KPI trend
/**
 * The signed change between the earlier and the later half of a window's weekly series, or `null`
 * when there is no base to compare against — fewer than two weeks, or nothing in the earlier half. A
 * rise from zero has no percentage, and inventing one (dividing by 1 instead) is how a seller's first
 * sale came to read as a 49,900% jump. An odd-length series leaves its middle week out of both halves
 * rather than counting it twice.
 */
export function halfOverHalf(trend: readonly number[]): number | null {
	const half = Math.floor(trend.length / 2);
	if (half < 1) return null;
	const earlier = trend.slice(0, half).reduce((s, n) => s + n, 0);
	const later = trend.slice(trend.length - half).reduce((s, n) => s + n, 0);
	if (earlier <= 0) return null;
	return Math.round(((later - earlier) / earlier) * 100);
}
// #endregion

// #region Live-preview item builder
/**
 * Reconstruct a discovery {@link ServiceItem}/{@link ProductItem} from an edited listing so the manage
 * page can render the REAL explore card. The card reads only a handful of fields (title, owner, media,
 * the pricing pair, delivery, category, serviceType) — the rest are inert placeholders required by the
 * discovery schema (`skills`/`summary`/`createdAt`). The pricing display string is the already-resolved
 * projection (`detail.price.display`), so the card's fixed-price fallback matches the console + `/view`.
 *
 * The listing's `currency` and its fixed price as integer minor units travel too: the cards render
 * money through `MoneyView` from those two fields, and without them a pound or euro listing previewed
 * as dollars — the card's own default — while the console beside it said otherwise.
 */
export function buildPreviewItem(detail: ListingDetail): ServiceItem | ProductItem {
	const currency = detail.currency;
	const priceMinor = detail.pricing.amount > 0
		? toMinorUnits(detail.pricing.amount, currency) ?? undefined
		: undefined;
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
			priceMinor,
			currency,
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
		priceMinor,
		currency,
		rating,
	};
}
// #endregion
