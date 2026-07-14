import type { ExploreCategory } from "../types/explore-types.ts";

/**
 * Adaptive filter configuration.
 *
 * The Search Results sidebar is data-driven: it renders the {@link FilterGroup}s for the active
 * top-level category, so switching category swaps the available facets with no per-category
 * component branching. Values here are stub facets that mirror the fixture data; they become the
 * real discovery-facet contract once the API lands.
 */

// #region Types
/** The control an individual facet renders as. */
export type FilterControl = "chips" | "checkbox" | "range" | "select";

/** A single selectable option within a `chips` / `checkbox` / `select` facet. */
export interface FilterOption {
	value: string;
	label: string;
}

/** One collapsible facet in the sidebar. */
export interface FilterGroup {
	/** URL param key this facet writes (must not collide with reserved keys — see explore-state). */
	id: string;
	label: string;
	control: FilterControl;
	/** Options for `chips` / `checkbox` / `select`. */
	options?: FilterOption[];
	/** Range bounds for `range`. */
	min?: number;
	max?: number;
	step?: number;
	/** Unit suffix rendered beside a range value, e.g. "$" or "min". */
	unit?: string;
}
// #endregion

// #region Sort
/** Sort options; `recommended` is the default (matches explore-state DEFAULT_SORT). */
export const SORT_OPTIONS: FilterOption[] = [
	{ value: "recommended", label: "Recommended" },
	{ value: "rating", label: "Top rated" },
	{ value: "price_asc", label: "Price: low to high" },
	{ value: "newest", label: "Newest" },
];
// #endregion

// #region Config
const SKILL_OPTIONS: FilterOption[] = [
	{ value: "technical", label: "Technical" },
	{ value: "design", label: "Design" },
	{ value: "motion", label: "Motion & video" },
	{ value: "content", label: "Content & writing" },
	{ value: "data", label: "Data" },
	{ value: "spatial", label: "3D & spatial" },
];

const RATING_OPTIONS: FilterOption[] = [
	{ value: "4.5", label: "4.5 & up" },
	{ value: "4", label: "4.0 & up" },
	{ value: "3.5", label: "3.5 & up" },
];

const BASE: FilterGroup[] = [
	{ id: "rating", label: "Rating", control: "select", options: RATING_OPTIONS },
	{
		id: "verified",
		label: "Trust",
		control: "checkbox",
		options: [{ value: "verified", label: "Verified only" }],
	},
];

/**
 * Category → facet groups. `all` (a cross-category query) shows only the universal facets; each
 * isolated category adds its own. Referenced by the sidebar via `FILTER_CONFIG[params.category]`.
 */
export const FILTER_CONFIG: Record<ExploreCategory, FilterGroup[]> = {
	all: BASE,
	users: [...BASE, { id: "skill", label: "Skills", control: "chips", options: SKILL_OPTIONS }],
	freelancers: [
		{ id: "skill", label: "Skills", control: "chips", options: SKILL_OPTIONS },
		{ id: "price", label: "Lowest rate", control: "range", min: 0, max: 500, step: 10, unit: "$" },
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
		{ id: "price", label: "Price", control: "range", min: 0, max: 12000, step: 100, unit: "$" },
		{
			id: "delivery",
			label: "Delivery",
			control: "select",
			options: [
				{ value: "3", label: "Up to 3 days" },
				{ value: "7", label: "Up to 1 week" },
				{ value: "30", label: "Up to 1 month" },
			],
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
		{ id: "budget", label: "Budget", control: "range", min: 0, max: 150000, step: 5000, unit: "$" },
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
		{ id: "price", label: "Price", control: "range", min: 0, max: 200, step: 5, unit: "$" },
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
			unit: "min",
		},
	],
};
// #endregion
