import { CreateCategory } from "@projective/types/org";
import { CREATE_CATEGORY_OPTIONS } from "@web/features/catalogue/core/catalogue-model.ts";
import type { CreateStageInput } from "../types/projects-types.ts";

/**
 * create-stage — the pure model behind the Create stage popover (Decision #416): the CREATE category
 * choices it offers and the payload its draft becomes. No JSX and no DOM, so it is unit-tested apart
 * from the popover that renders it.
 */

// #region Category choices
/** The category Select's value for "no category yet". */
export const NO_STAGE_CATEGORY = "none";

/** One row of the category Select. */
export interface StageCategoryOption {
	label: string;
	value: string;
}

/** The six CREATE categories in framework order, then "Not set" — the stage stays untyped. */
export const STAGE_CATEGORY_OPTIONS: readonly StageCategoryOption[] = [
	...CREATE_CATEGORY_OPTIONS.map((c) => ({ label: c.label, value: c.value })),
	{ label: "Not set", value: NO_STAGE_CATEGORY },
];
// #endregion

// #region Payload
/** The longest stage name the write accepts (`CreateStageInputSchema.name`). */
export const STAGE_NAME_MAX = 120;

/** What the popover holds while it is being filled in. */
export interface CreateStageDraft {
	name: string;
	/** A CREATE category, or {@link NO_STAGE_CATEGORY}. */
	category: string;
	/** The baseline rate in minor units, or `null` when left empty. */
	rateMinor: number | null;
	/** Whether a rate is offered here at all — not on a personal project, nor without a currency. */
	priced: boolean;
}

/**
 * The create payload for a draft, or `null` while it has no name. A category outside the framework and
 * a rate where none is offered both resolve to `null`, so the write never carries a term the popover
 * did not show. A rate of zero is kept: a free stage and an unpriced one are different facts.
 */
export function createStagePayload(draft: CreateStageDraft): CreateStageInput | null {
	const name = draft.name.trim().slice(0, STAGE_NAME_MAX);
	if (!name) return null;
	const category = CreateCategory.safeParse(draft.category);
	const rate = draft.priced && draft.rateMinor !== null && Number.isFinite(draft.rateMinor) &&
			draft.rateMinor >= 0
		? Math.round(draft.rateMinor)
		: null;
	return {
		name,
		description: "",
		createCategory: category.success ? category.data : null,
		unitPriceCents: rate,
	};
}
// #endregion
