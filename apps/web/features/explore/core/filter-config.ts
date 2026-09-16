import {
	type Facet,
	type FacetInput,
	type FacetOption,
	FacetSchema,
	mergeFacets,
} from "@projective/types/explore";
import type { ExploreCategory, ServiceType } from "../types/explore-types.ts";

/**
 * Adaptive filter configuration.
 *
 * The Search Results sidebar is data-driven: it renders the {@link Facet}s for the active top-level
 * category, so switching category swaps the available facets with no per-category component
 * branching. The SHAPE is the Zod SSOT (`@projective/types/explore` `FacetSchema`), which is also
 * what the discovery API attaches under `SearchPayload.facets` — so a scope-specific facet delivered
 * at runtime (a voice actor's accent, a rate per word) renders through the same list via
 * {@link activeFilterConfigs}, and the static lists here are just the part that does not depend on a
 * query. Values here are stub facets that mirror the fixture data; they become the real discovery-
 * facet contract once the API lands.
 */

// #region Types
export type { Facet, FacetOption };
/** @deprecated alias kept for older imports — a filter group IS a facet. */
export type FilterGroup = Facet;
export type FilterOption = FacetOption;
// #endregion

// #region Sort
/** Sort options; `recommended` is the default (matches explore-state DEFAULT_SORT). */
export const SORT_OPTIONS: FacetOption[] = [
	{ value: "recommended", label: "Recommended" },
	{ value: "rating", label: "Top rated" },
	{ value: "price_asc", label: "Price: low to high" },
	{ value: "newest", label: "Newest" },
];
// #endregion

// #region Vocabularies
const SKILL_OPTIONS: FacetOption[] = [
	{ value: "technical", label: "Technical" },
	{ value: "design", label: "Design" },
	{ value: "motion", label: "Motion & video" },
	{ value: "content", label: "Content & writing" },
	{ value: "data", label: "Data" },
	{ value: "spatial", label: "3D & spatial" },
];

/**
 * Delivery model → its facet label. Typed as a TOTAL `Record<ServiceType, …>` deliberately: a sixth
 * delivery model added to the SSOT enum then fails the type-check here rather than quietly shipping
 * unfilterable, which is exactly the state a booked session was in before this facet existed.
 *
 * Each label is its value verbatim, because these same strings are what a `ServiceCard` prints on its
 * type chip — the facet a reader clicks should read the same as the badge on the card it returns.
 */
const MODEL_LABELS: Record<ServiceType, string> = {
	"Pipeline": "Pipeline",
	"One-Off": "One-Off",
	"Direct Deliverable": "Direct Deliverable",
	"Session": "Session",
	"Group Session": "Group Session",
};

/**
 * Values are the raw `ServiceType` strings rather than slugs: the server compares them straight
 * against `ServiceItem.serviceType`, so slugging them would buy a tidier URL (`?model=group-session`)
 * at the price of a translation table living on both sides of the wire — two vocabularies that only
 * have to drift once. The URL says `?model=Group+Session` instead, and means it.
 */
const MODEL_OPTIONS: FacetOption[] = Object.entries(MODEL_LABELS)
	.map(([value, label]) => ({ value, label }));

/**
 * The delivery-time track. Non-linear on purpose — a reader thinks in "this week / this month", not
 * in a count of days — and the `value` is the number of days the backend compares a listing's
 * delivery against (`query.ts` `deliveryDays`). The last stop is the loosest, and therefore the default.
 */
export const DELIVERY_MILESTONES = [
	{ value: 1, label: "Same day" },
	{ value: 3, label: "1–3 days" },
	{ value: 7, label: "1 week" },
	{ value: 14, label: "2 weeks" },
	{ value: 30, label: "1 month" },
	{ value: 90, label: "3 months" },
] as const;

/** A minimum-rating facet — the same control on every scope that carries a reputation. */
const RATING: FacetInput = {
	id: "rating",
	label: "Rating",
	hint: "Minimum rating",
	control: "rating",
};

const BASE: FacetInput[] = [
	RATING,
	{
		id: "verified",
		label: "Trust",
		control: "checkbox",
		options: [{ value: "verified", label: "Verified only" }],
	},
];
// #endregion

// #region Config
/**
 * The static per-category facets, as AUTHORED. Parsed once below so every facet carries the SSOT's
 * defaults (`step`, `stars`, `precision`) and an ill-formed entry fails at module load, in
 * development, rather than at the first render of the category it belongs to.
 */
const STATIC: Record<ExploreCategory, FacetInput[]> = {
	all: BASE,
	users: [...BASE, { id: "skill", label: "Skills", control: "chips", options: SKILL_OPTIONS }],
	freelancers: [
		{ id: "skill", label: "Skills", control: "chips", options: SKILL_OPTIONS },
		{
			id: "price",
			label: "Hourly rate",
			control: "range",
			min: 0,
			max: 500,
			step: 10,
			symbol: "$",
		},
		...BASE,
	],
	teams: [
		{ id: "skill", label: "Disciplines", control: "chips", options: SKILL_OPTIONS },
		{ id: "members", label: "Team size", control: "range", min: 1, max: 40, step: 1 },
		...BASE,
	],
	businesses: [
		{
			id: "industry",
			label: "Industry",
			control: "chips",
			options: [
				{ value: "fintech", label: "Fintech" },
				{ value: "commerce", label: "Commerce" },
				{ value: "media", label: "Media" },
				{ value: "saas", label: "SaaS" },
			],
		},
		...BASE,
	],
	services: [
		// Leads the group: how a service is DELIVERED (booked time vs. a pipeline of tickets vs. a
		// one-off scope) is a bigger decision than what it is about, and it is what a reader arriving
		// from the Home "Sessions" chip has already chosen.
		{ id: "model", label: "Delivery model", control: "chips", options: MODEL_OPTIONS },
		{
			id: "cat",
			label: "Category",
			control: "chips",
			options: [
				{ value: "branding", label: "Branding" },
				{ value: "web", label: "Web" },
				{ value: "product", label: "Product" },
				{ value: "motion", label: "Motion" },
				{ value: "content", label: "Content" },
			],
		},
		{
			id: "price",
			label: "Price",
			control: "range",
			min: 0,
			max: 12000,
			step: 100,
			symbol: "$",
		},
		{
			id: "delivery",
			label: "Delivery time",
			hint: "Delivered within",
			control: "milestones",
			milestones: [...DELIVERY_MILESTONES],
		},
		...BASE,
	],
	projects: [
		{
			id: "stage",
			label: "Stage",
			control: "checkbox",
			options: [
				{ value: "hiring", label: "Hiring" },
				{ value: "planning", label: "Planning" },
				{ value: "in-progress", label: "In progress" },
			],
		},
		{
			id: "budget",
			label: "Budget",
			control: "range",
			min: 0,
			max: 150000,
			step: 5000,
			symbol: "$",
		},
		{ id: "roles", label: "Roles", control: "chips", options: SKILL_OPTIONS },
	],
	products: [
		{
			id: "cat",
			label: "Category",
			control: "chips",
			options: [
				{ value: "ui-kit", label: "UI kits" },
				{ value: "templates", label: "Templates" },
				{ value: "presets", label: "Presets" },
				{ value: "icons", label: "Icons" },
				{ value: "3d", label: "3D" },
			],
		},
		{ id: "price", label: "Price", control: "range", min: 0, max: 200, step: 5, symbol: "$" },
		...BASE,
	],
	articles: [
		{
			id: "topic",
			label: "Topic",
			control: "chips",
			options: [
				{ value: "hiring", label: "Hiring" },
				{ value: "payments", label: "Payments" },
				{ value: "teams", label: "Teams" },
				{ value: "getting-started", label: "Getting started" },
			],
		},
		{
			id: "readMinutes",
			label: "Read time",
			control: "range",
			min: 1,
			max: 30,
			step: 1,
			suffix: "min",
		},
	],
};

/**
 * Category → facet list, parsed through the SSOT. Referenced by the sidebar via
 * {@link activeFilterConfigs}; read directly only where the dynamic half is known to be absent.
 */
export const FILTER_CONFIG: Record<ExploreCategory, Facet[]> = Object.fromEntries(
	Object.entries(STATIC).map(([category, facets]) => [
		category,
		facets.map((f) => FacetSchema.parse(f)),
	]),
) as Record<ExploreCategory, Facet[]>;

/**
 * The facet list the sidebar renders for a scope: the static per-category facets merged with the
 * scope-specific ones the discovery service attached to the payload (`SearchPayload.facets`). This
 * is the ONE seam a category-specific dynamic filter enters through — the renderer maps over the
 * result and never learns which half a facet came from.
 */
export function activeFilterConfigs(
	category: ExploreCategory,
	dynamic: readonly Facet[] | undefined = [],
): Facet[] {
	return mergeFacets(FILTER_CONFIG[category], dynamic);
}
// #endregion
