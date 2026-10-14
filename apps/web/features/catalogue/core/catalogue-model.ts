import type { UserContext } from "@projective/types/auth";
import type { CreateCategory } from "@projective/types/org";
import { workspaceHref } from "../types/catalogue-types.ts";
import type {
	CatalogueSort,
	CatalogueTypeFilter,
	ListingDetail,
	ListingStatus,
	ServiceType,
} from "../types/catalogue-types.ts";

/** Whether the acting context can offer/sell (freelancer or a team context) — the seller predicate. */
export function isSeller(context: UserContext): boolean {
	return context.isFreelancer || context.contextType === "team";
}

/**
 * catalogue-model — the pure, presentation-agnostic helpers the Catalogue islands share: route hrefs,
 * status metadata and the type/sort/model option vocabularies. The live card is drawn from
 * `listingCardItem` (`@projective/types/explore`), the mapping discovery itself uses. No state, no
 * DOM — safe to import anywhere.
 */

// #region Route hrefs
/** The console canvas's id — the region the header's view tabs control. */
export const CONSOLE_CANVAS_ID = "cat-canvas";

/** The item workspace for a listing (its default tab). */
export function listingHref(id: string): string {
	return workspaceHref(id, {});
}

/** The public Entity View for a listing (the "View public page" link). */
export function publicListingHref(detail: Pick<ListingDetail, "id" | "kind">): string {
	return `/view/${detail.id}?type=${detail.kind === "service" ? "services" : "products"}`;
}

// #endregion

// #region Status metadata
/** A status's display label and tonal key (the status chip's `data-tone`). */
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

/** The lane's status facet, in display order. */
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

/** The five delivery models, typed, in menu order. */
export const SERVICE_MODELS: readonly ServiceType[] = [
	"Pipeline",
	"One-Off",
	"Direct Deliverable",
	"Session",
	"Group Session",
];

/** A CREATE category with the words the console shows for it (PRODUCT_SPEC §The CREATE Framework). */
export interface CreateCategoryOption {
	value: CreateCategory;
	label: string;
	/** What work in the category looks like. */
	hint: string;
}

/** The six CREATE categories, in framework order. */
export const CREATE_CATEGORY_OPTIONS: readonly CreateCategoryOption[] = [
	{ value: "create", label: "Create", hint: "Asset generation and production" },
	{ value: "run", label: "Run", hint: "Operations and maintenance" },
	{ value: "educate", label: "Educate", hint: "Structured knowledge transfer" },
	{ value: "advise", label: "Advise", hint: "Strategy and high-level guidance" },
	{ value: "test", label: "Test", hint: "Validation and quality assurance" },
	{ value: "empower", label: "Empower", hint: "Handover and client enablement" },
];

/** The plural noun for a type segment — the console never says "items". */
export function scopeNoun(type: CatalogueTypeFilter): string {
	return type === "service" ? "services" : type === "product" ? "products" : "listings";
}

/** `3 listings` / `1 service`. */
export function countLabel(n: number, type: CatalogueTypeFilter): string {
	const noun = scopeNoun(type);
	return `${n.toLocaleString("en-US")} ${n === 1 ? noun.slice(0, -1) : noun}`;
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

export { defaultSortDir } from "../types/catalogue-types.ts";

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

// #region Grid metrics
/**
 * A CSS length a custom property resolved to (`16px`, `7.25rem`), in px. `rem` is resolved against
 * the root font size; anything else (`em`, a percentage, a `calc()`) is `null`, because it has no px
 * value without a box to resolve it in.
 */
export function cssLengthPx(value: string, rootPx: number): number | null {
	const m = /^\s*(-?\d*\.?\d+)(px|rem)\s*$/.exec(value);
	if (!m) return null;
	const n = Number.parseFloat(m[1]);
	return m[2] === "rem" ? n * rootPx : n;
}

/** Height over width for a CSS `aspect-ratio` value (`16 / 10` → 0.625); `null` when unreadable. */
export function aspectFraction(value: string): number | null {
	const m = /^\s*(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?\s*$/.exec(value);
	if (!m) return null;
	const w = Number.parseFloat(m[1]);
	const h = m[2] === undefined ? 1 : Number.parseFloat(m[2]);
	return w > 0 && h > 0 ? h / w : null;
}
// #endregion
