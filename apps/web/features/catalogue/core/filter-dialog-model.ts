import { CreateCategory } from "@projective/types/org";
import {
	type CatalogueFacetCounts,
	type CatalogueStatusCounts,
	ConsoleHighlight,
	type ConsoleUrlState,
	DEFAULT_CONSOLE_STATUSES,
	isDefaultStatuses,
	ListingStatus,
	ServiceType,
} from "@projective/types/catalogue";
import { CREATE_CATEGORY_OPTIONS, SERVICE_MODELS, STATUS_SECTIONS } from "./catalogue-model.ts";

/**
 * filter-dialog-model — the pure half of the catalogue's filter dialog (Decision #312), which carries
 * the console lane's four facets where there is no lane (the team catalogue): what the dialog edits,
 * how a pressed set becomes facet values, how many facets narrow the listings, and the words the
 * toolbar's filter button and each option are named by.
 */

// #region Facets
/** The facets the dialog edits — the lane's four, in the URL's vocabulary. */
export interface ConsoleFacets {
	status: ListingStatus[];
	highlights: ConsoleHighlight[];
	model: ServiceType[];
	create: CreateCategory[];
}

/** The facets with nothing narrowed: every status but Archived, and no other facet chosen. */
export function defaultFacets(): ConsoleFacets {
	return { status: [...DEFAULT_CONSOLE_STATUSES], highlights: [], model: [], create: [] };
}

/** The facets a console state holds. */
export function facetsOf(state: ConsoleUrlState): ConsoleFacets {
	return {
		status: [...state.status],
		highlights: [...state.highlights],
		model: [...state.model],
		create: [...state.create],
	};
}

/** The values of `order` that `pressed` holds, in `order`'s order; anything unknown is dropped. */
export function pickFrom<T extends string>(order: readonly T[], pressed: readonly string[]): T[] {
	return order.filter((v) => pressed.includes(v));
}

/** Pressed option values as facets, in the URL contract's canonical order. */
export function facetsFrom(pressed: Record<keyof ConsoleFacets, readonly string[]>): ConsoleFacets {
	const status = pickFrom(ListingStatus.options, pressed.status);
	return {
		status: status.length ? status : [...DEFAULT_CONSOLE_STATUSES],
		highlights: pickFrom(ConsoleHighlight.options, pressed.highlights),
		model: pickFrom(ServiceType.options, pressed.model),
		create: pickFrom(CreateCategory.options, pressed.create),
	};
}

/**
 * The status facet is never empty (the URL contract reads an empty one as the default set), so
 * releasing the last chosen status leaves the previous choice standing.
 */
export function nextStatuses(previous: readonly string[], pressed: readonly string[]): string[] {
	return pressed.length > 0 ? [...pressed] : [...previous];
}

/**
 * How many facets narrow the listings: a status choice other than the default counts once, and every
 * chosen highlight, delivery model and CREATE category once each.
 */
export function appliedFilterCount(facets: ConsoleFacets): number {
	return (isDefaultStatuses(facets.status) ? 0 : 1) + facets.highlights.length +
		facets.model.length + facets.create.length;
}
// #endregion

// #region Words
/** The toolbar filter button's accessible name; the engaged state is otherwise only a dot. */
export function filterButtonLabel(applied: number): string {
	return applied === 0 ? "Filter listings" : `Filter listings, ${applied} active`;
}

/** A facet option's second line: how many listings it holds. */
export function countLine(count: number): string {
	return `${count.toLocaleString("en-US")} ${count === 1 ? "listing" : "listings"}`;
}

/** One pressable option of a facet group. */
export interface FacetOption {
	label: string;
	value: string;
	description: string;
}

const HIGHLIGHT_LABEL: Readonly<Record<ConsoleHighlight, string>> = {
	"attention": "Needs attention",
	"promoted": "Promoted",
	"best-selling": "Best-selling",
};

/** The status group's options, in the lane's order. */
export function statusOptions(counts: CatalogueStatusCounts): FacetOption[] {
	return STATUS_SECTIONS.map((s) => ({
		label: s.label,
		value: s.status,
		description: countLine(counts[s.status]),
	}));
}

/** The highlight group's options. */
export function highlightOptions(counts: CatalogueFacetCounts): FacetOption[] {
	const count: Readonly<Record<ConsoleHighlight, number>> = {
		"attention": counts.needsAttention,
		"promoted": counts.promoted,
		"best-selling": counts.bestSelling,
	};
	return ConsoleHighlight.options.map((h) => ({
		label: HIGHLIGHT_LABEL[h],
		value: h,
		description: countLine(count[h]),
	}));
}

/** The delivery-model group's options (services only). */
export function modelOptions(counts: CatalogueFacetCounts): FacetOption[] {
	return SERVICE_MODELS.map((m) => ({
		label: m,
		value: m,
		description: countLine(counts.model[m] ?? 0),
	}));
}

/** The CREATE-category group's options. */
export function createOptions(counts: CatalogueFacetCounts): FacetOption[] {
	return CREATE_CATEGORY_OPTIONS.map((c) => ({
		label: c.label,
		value: c.value,
		description: countLine(counts.create[c.value] ?? 0),
	}));
}
// #endregion
