import type { Option } from "@projective/ui/fields";
import { DISPLAY_CURRENCIES } from "@projective/types/finance";
import { FileCategory } from "@projective/types/files";
import type {
	IpOwnershipMode,
	NdaMode,
	PortfolioDisplayRights,
	ProjectCreateFormat,
	ProjectVisibility,
	StageDurationMode,
} from "../../types/projects-types.ts";

/**
 * The words the creation wizard puts on its enum members, and the option lists built from them.
 *
 * Written as exhaustive `Record`s keyed on the SSOT enum types rather than as free option arrays, so
 * a member added to a schema fails to compile here instead of quietly rendering a control that is
 * missing one of its own values. `optionsOf` preserves declaration order, which is the order the
 * schema author chose and the order a reader scanning two adjacent controls expects.
 */

// #region Label maps
/** Turn an exhaustive label map into the `Option[]` a `Select` takes, in declaration order. */
export function optionsOf<K extends string>(labels: Record<K, string>): Option[] {
	return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}

/**
 * The two work-flows the wizard OFFERS.
 *
 * `direct_deliverable` is deliberately absent: it is not a third choice an author makes, it is the
 * stages-off variant of a one-off, and the Stages step's toggle is where that decision belongs. The
 * enum keeps the member because `projects.structure_variation` stores `single_task` and the setup
 * ladder swaps its staffing row on exactly that value.
 */
export const FORMAT_LABEL: Record<"pipeline" | "one_off", string> = {
	pipeline: "Pipeline",
	one_off: "One-off",
};

/** What each work-flow means for the person delivering it. */
export const FORMAT_HINT: Record<"pipeline" | "one_off", string> = {
	pipeline: "Continuous work claimed ticket by ticket, stage after stage.",
	one_off: "A fixed engagement delivered against milestones for a set fee.",
};

/** The two options, as segments. */
export const FORMAT_OPTIONS: Option[] = optionsOf(FORMAT_LABEL);

export const VISIBILITY_LABEL: Record<ProjectVisibility, string> = {
	public: "Public — listed on Explore",
	invite_only: "Invite only — reachable by invitation",
	unlisted: "Unlisted — reachable by link",
};

export const IP_LABEL: Record<IpOwnershipMode, string> = {
	exclusive_transfer: "Exclusive transfer to me",
	licensed_use: "Licensed use",
	shared_ownership: "Shared ownership",
	projective_partner: "Projective partner terms",
};

export const PORTFOLIO_LABEL: Record<PortfolioDisplayRights, string> = {
	allowed: "May be shown publicly",
	forbidden: "May not be shown",
	embargoed: "May be shown after an embargo",
};

export const NDA_LABEL: Record<NdaMode, string> = {
	none: "No NDA",
	platform_standard: "Projective standard NDA",
	custom: "My own NDA",
};

/** What each NDA choice actually commits both sides to. */
export const NDA_HINT: Record<NdaMode, string> = {
	none: "Nothing is confidential beyond the platform's own terms.",
	platform_standard: "Everyone joining accepts Projective's standard confidentiality terms.",
	custom: "Everyone joining accepts the document you attach below.",
};

export const DURATION_LABEL: Record<StageDurationMode, string> = {
	no_due_date: "No due date",
	relative_duration: "A number of days",
	fixed_deadline: "A fixed date",
};

export const VISIBILITY_OPTIONS: Option[] = optionsOf(VISIBILITY_LABEL);
export const IP_OPTIONS: Option[] = optionsOf(IP_LABEL);
export const PORTFOLIO_OPTIONS: Option[] = optionsOf(PORTFOLIO_LABEL);
export const NDA_OPTIONS: Option[] = optionsOf(NDA_LABEL);
export const DURATION_OPTIONS: Option[] = optionsOf(DURATION_LABEL);

/** How the engagement is priced, at the project level. */
export const BUDGET_TYPE_OPTIONS: Option[] = [
	{ value: "fixed_price", label: "Fixed price" },
	{ value: "hourly_cap", label: "Hourly cap" },
];

/**
 * The currencies a project may be priced in.
 *
 * The offerable display set rather than a private list, because every one of them has a rate behind
 * it in `finance.fx_rates` — a code with no rate is a price no reader can be shown a conversion of.
 */
export const CURRENCY_OPTIONS: Option[] = DISPLAY_CURRENCIES.map((currency) => ({
	value: currency.code,
	label: `${currency.code} · ${currency.label}`,
}));

/** Every file category a stage may restrict its submissions to. */
export const FILE_CATEGORY_OPTIONS: Option[] = FileCategory.options.map((category) => ({
	value: category,
	label: category,
}));
// #endregion

// #region Nouns
/** The word a work-flow gives one row of its stage list. */
export function stageNoun(format: ProjectCreateFormat): string {
	return format === "pipeline" ? "stage" : "milestone";
}

/** The heading a work-flow gives its stage list. */
export function stageNounPlural(format: ProjectCreateFormat): string {
	return format === "pipeline" ? "Stages" : "Milestones";
}

/** What a stage's price IS, which differs by work-flow rather than by preference. */
export function priceLabel(format: ProjectCreateFormat): string {
	return format === "pipeline" ? "Ticket price" : "Fixed fee";
}
// #endregion
