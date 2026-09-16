import { z } from "zod";

/**
 * Discovery FACETS — the schema of one adaptive filter in the Explore sidebar.
 *
 * A facet is a description of a CONTROL and the URL values it writes, not the control itself: the
 * sidebar maps a list of these onto renderers, so a category-specific facet (a voice actor's
 * accent, a translator's rate per word) can arrive from the discovery API as data and render with
 * no new layout code. The static per-category lists live app-side (`filter-config.ts`) and are
 * merged with whatever the search payload attaches under `facets` — same shape, one renderer.
 *
 * Every facet's selection is carried in `ExploreParams.filters[id]` as `string[]`, because that is
 * what a URL can hold; the pure helpers below are the ONE place a facet's "default" is decided, so
 * the reset control, the active-count badge and the URL serialiser cannot disagree about whether a
 * facet is set.
 */

// #region Shared
/** A selectable option in a `chips` / `checkbox` / `select` / `multiselect` facet. */
export const FacetOptionSchema = z.object({
	value: z.string(),
	label: z.string(),
});
export type FacetOption = z.infer<typeof FacetOptionSchema>;

/** One labelled stop on a `milestones` track — the value is the caller's unit (days, seats, …). */
export const FacetMilestoneSchema = z.object({
	value: z.number(),
	label: z.string(),
});
export type FacetMilestone = z.infer<typeof FacetMilestoneSchema>;

const facetBase = {
	/** URL param key this facet writes (must not collide with the reserved keys — see explore-state). */
	id: z.string().min(1),
	label: z.string(),
	/** A one-line explanation under the label, where the label alone would be ambiguous. */
	hint: z.string().optional(),
} as const;
// #endregion

// #region Kinds
/** Multi-select pill cluster; values are the chosen options' `value`s. */
export const ChipsFacetSchema = z.object({
	...facetBase,
	control: z.literal("chips"),
	options: z.array(FacetOptionSchema),
});

/** Multi-select checkbox list; values are the chosen options' `value`s. */
export const CheckboxFacetSchema = z.object({
	...facetBase,
	control: z.literal("checkbox"),
	options: z.array(FacetOptionSchema),
});

/** Single-choice dropdown; the value is the one chosen option's `value` (empty = any). */
export const SelectFacetSchema = z.object({
	...facetBase,
	control: z.literal("select"),
	options: z.array(FacetOptionSchema),
});

/** Multi-choice dropdown — for a long vocabulary a pill cluster would not fit (languages, accents). */
export const MultiSelectFacetSchema = z.object({
	...facetBase,
	control: z.literal("multiselect"),
	options: z.array(FacetOptionSchema),
});

/**
 * A bounded numeric interval — values are `[min, max]` as two strings. Absent means the whole
 * track; a pair equal to the bounds is the same thing and normalises to absent.
 */
export const RangeFacetSchema = z.object({
	...facetBase,
	control: z.literal("range"),
	min: z.number(),
	max: z.number(),
	step: z.number().positive().default(1),
	/** Leading adornment on the boxes — a currency symbol (`$`) or a unit. */
	symbol: z.string().optional(),
	/** Trailing unit after each box's figure (`min`, `words`). */
	suffix: z.string().optional(),
});

/** A minimum star rating — the value is one number (`"3.5"`); absent means any. */
export const RatingFacetSchema = z.object({
	...facetBase,
	control: z.literal("rating"),
	stars: z.number().int().positive().default(5),
	precision: z.union([z.literal(1), z.literal(0.5)]).default(0.5),
});

/**
 * A discrete, non-linear track of named stops (delivery time, team size). The value is the chosen
 * stop's `value` as a string; absent means the LAST stop (the loosest), which is the track's default.
 */
export const MilestonesFacetSchema = z.object({
	...facetBase,
	control: z.literal("milestones"),
	milestones: z.array(FacetMilestoneSchema).min(2),
});

/** The union of every facet kind the sidebar can render. */
export const FacetSchema = z.discriminatedUnion("control", [
	ChipsFacetSchema,
	CheckboxFacetSchema,
	SelectFacetSchema,
	MultiSelectFacetSchema,
	RangeFacetSchema,
	RatingFacetSchema,
	MilestonesFacetSchema,
]);
export type Facet = z.infer<typeof FacetSchema>;
/** A facet as authored (before Zod defaults are applied) — what a static config file writes. */
export type FacetInput = z.input<typeof FacetSchema>;
export type FacetControl = Facet["control"];
export type RangeFacet = Extract<Facet, { control: "range" }>;
export type RatingFacet = Extract<Facet, { control: "rating" }>;
export type MilestonesFacet = Extract<Facet, { control: "milestones" }>;
export type OptionsFacet = Extract<Facet, { options: FacetOption[] }>;
// #endregion

// #region Pure helpers
/** The values a facet holds when nothing is selected — always the EMPTY list (the facet is absent). */
export function facetDefaultValues(_facet: Facet): string[] {
	return [];
}

/**
 * Whether `values` mean "nothing chosen" for this facet. Beyond emptiness, a range set to its own
 * bounds and a milestone set to its last stop are ALSO the default — the URL should not carry them,
 * and the reset control should not offer to undo them.
 */
export function facetIsDefault(facet: Facet, values: readonly string[] | undefined): boolean {
	if (!values || values.length === 0) return true;
	switch (facet.control) {
		case "range": {
			const [lo, hi] = rangeFacetValue(facet, values);
			return lo <= facet.min && hi >= facet.max;
		}
		case "milestones": {
			const last = facet.milestones[facet.milestones.length - 1];
			return milestoneFacetValue(facet, values) === last.value;
		}
		case "rating":
			return ratingFacetValue(values) <= 0;
		default:
			return false;
	}
}

/**
 * Normalise a facet's values for the URL: the default collapses to the empty list (so the serialiser
 * drops the key), a range is ordered and clamped, and a rating is clamped to the star count.
 */
export function normaliseFacetValues(facet: Facet, values: readonly string[]): string[] {
	if (facetIsDefault(facet, values)) return [];
	switch (facet.control) {
		case "range": {
			const [lo, hi] = rangeFacetValue(facet, values);
			return [String(lo), String(hi)];
		}
		case "rating":
			return [String(Math.min(facet.stars, ratingFacetValue(values)))];
		case "milestones":
			return [String(milestoneFacetValue(facet, values))];
		case "select":
			return [values[0]];
		default:
			return [...values];
	}
}

/** The `[lo, hi]` a range facet's values stand for — ordered, clamped, defaulting to the full track. */
export function rangeFacetValue(
	facet: RangeFacet,
	values: readonly string[] | undefined,
): [number, number] {
	const a = Number(values?.[0]);
	const b = Number(values?.[1]);
	const lo = Number.isFinite(a) ? a : facet.min;
	// A single value is the legacy "up to" form — the lower end is the track's own.
	const hi = Number.isFinite(b) ? b : Number.isFinite(a) && values?.length === 1 ? a : facet.max;
	const clampedLo = Math.min(Math.max(lo, facet.min), facet.max);
	const clampedHi = Math.min(Math.max(hi, facet.min), facet.max);
	return values?.length === 1
		? [facet.min, clampedHi]
		: clampedLo <= clampedHi
		? [clampedLo, clampedHi]
		: [clampedHi, clampedLo];
}

/** The minimum star rating a rating facet's values stand for (`0` = any). */
export function ratingFacetValue(values: readonly string[] | undefined): number {
	const n = Number(values?.[0]);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The stop a milestones facet's values select — the nearest real stop, defaulting to the last. */
export function milestoneFacetValue(
	facet: MilestonesFacet,
	values: readonly string[] | undefined,
): number {
	const stops = facet.milestones;
	const n = Number(values?.[0]);
	if (!Number.isFinite(n)) return stops[stops.length - 1].value;
	let best = stops[0].value;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const m of stops) {
		const d = Math.abs(m.value - n);
		if (d < bestDist) {
			bestDist = d;
			best = m.value;
		}
	}
	return best;
}

/**
 * Merge a static facet list with facets delivered at runtime (the API's per-scope facets). A runtime
 * facet with the same `id` REPLACES the static one — the server's description of a facet wins — and
 * the rest append in order, so a layout built over the merged list needs no knowledge of which is which.
 */
export function mergeFacets(base: readonly Facet[], dynamic: readonly Facet[] = []): Facet[] {
	if (dynamic.length === 0) return [...base];
	const byId = new Map(dynamic.map((f) => [f.id, f] as const));
	const merged = base.map((f) => byId.get(f.id) ?? f);
	const seen = new Set(base.map((f) => f.id));
	for (const f of dynamic) if (!seen.has(f.id)) merged.push(f);
	return merged;
}
// #endregion
