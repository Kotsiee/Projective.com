import { z } from "zod";
import { ContextType } from "../auth/mod.ts";
import { FileCategory } from "../files/categories.ts";

/**
 * projects.create — the Zod SSOT for the "Create New Project" wizard payload.
 *
 * Design intent (PRODUCT_SPEC §Projects): "quick to onboard, slow to set up". Only **title** is
 * mandatory; everything else carries a default, so a title-only submission is a valid draft and the
 * six-step wizard never blocks an author who wants to come back to a section later. These fields map
 * onto `projects.projects` (+ `projects.project_stages`) columns; the DB derives id/owner/status/
 * timestamps and the escrow wiring. The same schema validates client-side (wizard), in the thin
 * route, and in the fat service (mirrors `org/organisations.ts`'s Create shape).
 *
 * This module is the LEAF of the projects domain, which is why the engagement-term enums shared with
 * the setup projection ({@link ./setup.ts}) are declared here rather than beside the ladder that also
 * reads them. `setup.ts` already depends on this file; defining them there would need an import back
 * the other way, and a cycle between two modules whose corpora build at import time is a TDZ crash
 * rather than a style problem.
 */

// #region Engagement terms
/**
 * An ISO-4217 alphabetic currency code.
 *
 * One schema rather than a `min(1).max(8)` string at each site, because `projects.projects.currency`
 * carries `CHECK (currency ~ '^[A-Z]{3}$')` and a payload that accepted `"gbp"` or `"Dollars"` would
 * be refused by Postgres with a `23514` the author cannot act on — the wizard has to say what is
 * wrong while the field is still in front of them.
 */
export const CurrencyCode = z.string().regex(
	/^[A-Z]{3}$/,
	"Use a 3-letter currency code, e.g. GBP.",
);

/** Who can see the engagement, and how they reach it. */
export const ProjectVisibility = z.enum(["public", "invite_only", "unlisted"]);
export type ProjectVisibility = z.infer<typeof ProjectVisibility>;

/** What the client takes ownership of when the work is delivered. */
export const IpOwnershipMode = z.enum([
	"exclusive_transfer",
	"licensed_use",
	"shared_ownership",
	"projective_partner",
]);
export type IpOwnershipMode = z.infer<typeof IpOwnershipMode>;

/** Whether the provider may show the work publicly, and when. */
export const PortfolioDisplayRights = z.enum(["allowed", "forbidden", "embargoed"]);
export type PortfolioDisplayRights = z.infer<typeof PortfolioDisplayRights>;

/**
 * What governs confidentiality on the engagement.
 *
 * Three members, not four: "use a document I uploaded before" and "upload a new one" both resolve to
 * `custom` plus a {@link CreateProject.ndaDocumentId}. A fourth member would encode HOW the file
 * arrived rather than what governs the work, and every consumer would then have to collapse the two
 * back together before it could answer the only question that matters.
 */
export const NdaMode = z.enum(["none", "platform_standard", "custom"]);
export type NdaMode = z.infer<typeof NdaMode>;

/**
 * The legacy `projects.projects.nda_required` boolean, derived from {@link NdaMode}.
 *
 * The column is kept and stays readable by every existing consumer, so the two must never disagree
 * about whether an NDA governs the engagement. One implementation, called by whichever layer writes
 * the row, is what makes that structural rather than a convention.
 */
export function ndaRequiredFor(mode: NdaMode): boolean {
	return mode !== "none";
}

/**
 * The document reference a mode may legitimately carry.
 *
 * Mirrors `CHECK (nda_mode = 'custom' OR nda_document_id IS NULL)`: only a custom NDA names a file,
 * so switching the mode back to `none` or `platform_standard` must drop the reference rather than
 * leave a document pointed at by an engagement that no longer uses it.
 */
export function ndaDocumentFor(mode: NdaMode, documentId: string | null): string | null {
	return mode === "custom" ? documentId : null;
}

/**
 * How a stage's delivery date is expressed — the `project_stages.file_duration_mode` vocabulary.
 *
 * `no_due_date` rather than a nullable mode, because the column is nullable and a reader that had to
 * treat `NULL` and `'no_due_date'` as the same answer would be carrying two representations of one
 * state. The fat service normalises `NULL` to `no_due_date` on the way out.
 */
export const StageDurationMode = z.enum(["fixed_deadline", "relative_duration", "no_due_date"]);
export type StageDurationMode = z.infer<typeof StageDurationMode>;

/**
 * The uplift a client offers for early delivery on a pipeline, as a fraction of the ticket price.
 *
 * FLAGGED, and deliberately not resolved here: the 0.1 figure comes from the creation brief and
 * appears in NO source-of-truth document, and `PRODUCT_SPEC.md` assigns the Deadline Bonus to
 * ONE-OFF engagements rather than pipelines. It exists as exactly one greppable named constant so
 * the figure can be corrected in one place once a human settles it.
 *
 * It is NEVER written to the database and never enters a money path. The money path is the existing
 * `finance.escrows.deadline_bonus_*` columns; this constant only lets the wizard state the offer in
 * the sentence beside the toggle.
 */
export const DEADLINE_BONUS_RATE = 0.1;
// #endregion

// #region Optional deep-config sub-shapes
/** `finance.budget_type` — how a stage/engagement is priced. */
export const BudgetType = z.enum(["fixed_price", "hourly_cap"]);
export type BudgetType = z.infer<typeof BudgetType>;

/**
 * An optional budget metric for the engagement (mapped to stage budget rules on the server).
 *
 * `currency` duplicates {@link CreateProject.currency}, which is the half that maps to the
 * `projects.projects.currency` column; the two must agree and the top-level field is authoritative.
 * It is kept because it predates the wizard and several readers already destructure it.
 */
export const CreateProjectBudgetSchema = z.object({
	budgetType: BudgetType,
	/** Amount in minor units (cents) — integer, non-negative. */
	amountCents: z.number().int().min(0),
	currency: CurrencyCode.default("USD"),
});
export type CreateProjectBudget = z.infer<typeof CreateProjectBudgetSchema>;

/**
 * An optional phase/stage the actor sketches inline.
 *
 * Only `name` is required; everything else is the AMBER publishing gate rather than a create
 * blocker. Field names are IDENTICAL to `StageSetupSchema` in `./setup.ts` — the create payload and
 * the projection that reads the row back describe the same stage, and a pair that differed by one
 * character would drop the author's answer somewhere between the two with nothing to report it.
 */
export const CreateProjectStageSchema = z.object({
	name: z.string().min(1).max(120),
	/** Rich-text scope (HTML) for the stage. Capped to match the projection, not the other way round. */
	description: z.string().max(8000).default(""),
	/**
	 * The stage price in minor units; `null` = unpriced.
	 *
	 * One column for both engagement shapes: a pipeline reads it as the per-ticket rate and a one-off
	 * as the whole fixed fee, because a one-off stage is a one-ticket stage. A second price field
	 * would give "what does this stage cost" two answers while `finance.fn_hold_ticket_escrow` reads
	 * only one of them.
	 */
	unitPriceCents: z.number().int().min(0).nullable().default(null),
	/** Estimated delivery / milestone note (free text); optional. */
	milestone: z.string().max(240).default(""),
	/** The checklist a ticket raised against this stage is seeded from. Labels only. */
	tasks: z.array(z.string().min(1).max(240)).max(50).default([]),
	/** Skills a provider needs to work this stage. */
	skills: z.array(z.string().min(1).max(60)).max(10).default([]),
	/** Whether a submission against this stage must carry a file. */
	requiresFiles: z.boolean().default(true),
	/**
	 * How many providers may hold a seat on this stage; `null` = unlimited.
	 *
	 * Nullable-as-unlimited follows `finance.plan_entitlements`' own convention. It is headcount, and
	 * deliberately not `max_concurrent_intensity` (summed workload `W_i`) or a staffing role's
	 * `quantity` (per-role establishment) — the three answer different questions and sharing one
	 * column would make a cap on people read as a cap on effort.
	 */
	seatLimit: z.number().int().min(1).nullable().default(3),
	/** Whether this stage runs alongside the one it depends on rather than after it. */
	parallel: z.boolean().default(false),
	/**
	 * The stage this one waits on, as an index into {@link CreateProject.stages}; `null` = none.
	 *
	 * An index rather than an id because a stage being sketched in the wizard has no durable
	 * identity yet. The fat service resolves it to `project_stages.start_dependency_stage_id` after
	 * the rows exist.
	 */
	dependsOnStageIndex: z.number().int().min(0).nullable().default(null),
	/** Days to wait after the dependency resolves before this stage opens. */
	lagDays: z.number().int().min(0).max(365).default(0),
	/** Whether this stage carries confidentiality terms stricter than the project's. */
	ndaOverride: z.boolean().default(false),
	/** Categories a submission may carry; empty = every category. */
	allowedFileCategories: z.array(FileCategory).max(28).default([]),
	/** Extensions a submission may carry, without the dot; empty = every extension. */
	allowedFileExtensions: z.array(z.string().min(1).max(16)).max(50).default([]),
	/** How this stage's delivery date is expressed. */
	durationMode: StageDurationMode.default("no_due_date"),
	/** Days from the stage opening, when `durationMode` is `relative_duration`; else `null`. */
	durationDays: z.number().int().min(0).max(3650).nullable().default(null),
	/** The absolute deadline (ISO instant), when `durationMode` is `fixed_deadline`; else `null`. */
	dueDate: z.string().max(40).nullable().default(null),
});
export type CreateProjectStage = z.infer<typeof CreateProjectStageSchema>;

/**
 * An optional team role for a stage-less engagement, which takes no stages and is staffed by roles
 * instead. `name` is required once a role is added; `skills` are freeform tags. Maps to
 * `projects.stage_staffing_roles` rows on the live path.
 */
export const CreateProjectRoleSchema = z.object({
	name: z.string().min(1).max(120),
	skills: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type CreateProjectRole = z.infer<typeof CreateProjectRoleSchema>;
// #endregion

// #region Create payload
/**
 * The work-flow the author picks.
 *
 * The wizard OFFERS two — `pipeline` and `one_off` — while the enum keeps three. A Direct
 * Deliverable is not a third choice the author makes; it is the `hasStages: false` variant of a
 * one-off, and the member survives because `projects.structure_variation` stores `single_task`,
 * because the setup ladder swaps its staffing row from stages to roles on exactly that value, and
 * because both are reachable from an existing project the wizard never created.
 *
 * Session services stay provider-side (created from the service composer, not here). The
 * `projects.project_format` enum keeps its `session` member for those.
 */
export const ProjectCreateFormat = z.enum(["pipeline", "one_off", "direct_deliverable"]);
export type ProjectCreateFormat = z.infer<typeof ProjectCreateFormat>;

/**
 * The URL-safe address derived from a title.
 *
 * Shared rather than duplicated because `projects.projects.slug` carries a CHECK
 * (`^[a-z0-9-]{1,96}$`) and the route tree interpolates the value into a path segment verbatim: a
 * second slugifier that disagreed by one character would produce an engagement that exists and
 * cannot be opened. Truncated to 80 so the database's own disambiguating suffix still fits inside 96.
 *
 * Returns `""` for a title with nothing usable in it (punctuation only, or a non-Latin script). That
 * is deliberate and is NOT an error: the caller falls back to the column's generated `p-<hex>`
 * default, which is a valid address, rather than inventing prose the author did not write.
 */
export function projectSlugFrom(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
		.replace(/-+$/, "");
}

/**
 * What a create returns: the two durable identifiers, both of them.
 *
 * `slug` is what every `/projects/*` route addresses an engagement by, so it is what the client
 * navigates to. `id` is the primary key and the only thing a later write may safely reference — a
 * slug can be rewritten, a uuid cannot. Returning one without the other would force the caller to go
 * and read the row back for the half it was not given.
 */
export const CreatedProjectSchema = z.object({
	id: z.string().min(1).max(64),
	slug: z.string().min(1).max(96),
});
export type CreatedProject = z.infer<typeof CreatedProjectSchema>;

export const CreateProjectSchema = z.object({
	title: z.string().min(1, "Name your project.").max(160),
	/** Project Type. Defaults to `pipeline`; no longer create-blocking (only the title is RED). */
	format: ProjectCreateFormat.default("pipeline"),
	/**
	 * Whether the engagement is broken into stages.
	 *
	 * Never stored: `hasStages === (structure_variation !== 'single_task')`, so a real column would
	 * be a second answer able to disagree with the stage list itself, and `set_project_status`
	 * already reads the stage COUNT. It exists on the payload because it is what the author toggles,
	 * and {@link createFormatToColumns} folds it into the two columns that do get written.
	 */
	hasStages: z.boolean().default(true),
	/** Which workspace to create the engagement under; defaults to the actor's active context. */
	scopeType: ContextType.default("personal"),
	scopeId: z.string().max(64).default(""),
	/** Rich-text scope/brief (semantic HTML from the RichTextEditor). AMBER publishing gate. */
	scope: z.string().max(8000).default(""),
	/** The engagement's currency — authoritative over {@link CreateProjectBudget.currency}. */
	currency: CurrencyCode.default("USD"),
	/**
	 * What the author ASKS for.
	 *
	 * Not what gets stored: a freshly created project has satisfied none of its posting
	 * requirements, so the fat service runs `effectiveVisibility` and writes `unlisted` until the
	 * ladder says otherwise. Defaulting to `public` here states the intent the author will most
	 * often have without letting a half-written engagement reach Explore.
	 */
	visibility: ProjectVisibility.default("public"),
	/** What the client takes ownership of on delivery. */
	ipOwnershipMode: IpOwnershipMode.default("exclusive_transfer"),
	/** Whether the provider may show the work publicly, and when. */
	portfolioDisplayRights: PortfolioDisplayRights.default("allowed"),
	/** What governs confidentiality; `nda_required` is derived from it by {@link ndaRequiredFor}. */
	ndaMode: NdaMode.default("none"),
	/** The custom NDA document, when `ndaMode` is `custom`; `null` otherwise. */
	ndaDocumentId: z.string().max(64).nullable().default(null),
	/** Languages a provider must work in. Empty = no requirement. */
	languages: z.array(z.string().min(1).max(60)).max(20).default([]),
	/** Locations a provider must be in. Empty = anywhere, which is an answer rather than an omission. */
	locations: z.array(z.string().min(1).max(60)).max(20).default([]),
	/** Whether the client offers an early-delivery uplift. Pipeline only; see {@link DEADLINE_BONUS_RATE}. */
	allowDeadlineBonuses: z.boolean().default(false),
	/** Reference material attached to the brief — `files.items` ids. */
	attachmentIds: z.array(z.string().min(1).max(64)).max(10).default([]),
	/** Optional budget metric. */
	budget: CreateProjectBudgetSchema.nullable().default(null),
	/** Optional inline stages. Empty when `hasStages` is false. */
	stages: z.array(CreateProjectStageSchema).max(50).default([]),
	/** Optional team roles; the staffing model a stage-less engagement takes instead of stages. */
	roles: z.array(CreateProjectRoleSchema).max(20).default([]),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;
// #endregion

// #region The wizard's tier taxonomy
/**
 * How badly the wizard wants a field.
 *
 * FORM LOGIC ONLY. These drive exactly three things — step progression (`T1`), the publish gate
 * (`T1` + `T2`) and hint copy (`T3`–`T5`) — and they are NEVER rendered as five colours. The theme
 * has token backing for two gate ramps (`--fld-required-*`, `--fld-gate-*`); inventing three more
 * would breach DESIGN_SYSTEM §B.8.3/§A.5 and fail the colour-blindness gate, and a five-colour key
 * encodes a distinction nobody can read off a swatch anyway.
 */
export const FieldTier = z.enum(["T1", "T2", "T3", "T4", "T5"]);
export type FieldTier = z.infer<typeof FieldTier>;

/** The one-line meaning of each tier, for hint copy. Prose, never a colour. */
export const FIELD_TIER_MEANING: Record<FieldTier, string> = {
	T1: "Blocker",
	T2: "Required to post",
	T3: "Recommended",
	T4: "Nice to have",
	T5: "Conditional",
};

/** Whether a tier is one the publish gate waits on. */
export function blocksPosting(tier: FieldTier): boolean {
	return tier === "T1" || tier === "T2";
}

/** The six wizard steps, in order (`documentation/flows/Projects.md`). */
export const ProjectWizardStep = z.enum([
	"details",
	"legal",
	"stages",
	"timeline",
	"budget",
	"review",
]);
export type ProjectWizardStep = z.infer<typeof ProjectWizardStep>;

/** The heading each step carries. One rule, so the rail and the panel cannot name a step differently. */
export const WIZARD_STEP_LABEL: Record<ProjectWizardStep, string> = {
	details: "Details",
	legal: "Legal & Screening",
	stages: "Stages",
	timeline: "Timeline",
	budget: "Budget & Staffing",
	review: "Review & Publish",
};

/**
 * Every control the wizard renders, keyed by the payload field it writes.
 *
 * Per-stage controls carry a `stage` prefix because they are edited once per row of
 * {@link CreateProject.stages} rather than once per project, and a shared key would make a tier
 * lookup ambiguous about which of the two it was answering for.
 */
export const ProjectWizardField = z.enum([
	"title",
	"scope",
	"format",
	"currency",
	"visibility",
	"attachmentIds",
	"ipOwnershipMode",
	"ndaMode",
	"portfolioDisplayRights",
	"languages",
	"locations",
	"hasStages",
	"stageName",
	"stageDescription",
	"stageTasks",
	"stageSkills",
	"stageRequiresFiles",
	"stageAllowedFileTypes",
	"stageNdaOverride",
	"stageDependsOn",
	"stageParallel",
	"stageLagDays",
	"stageDuration",
	"allowDeadlineBonuses",
	"stageUnitPrice",
	"stageSeatLimit",
	"roles",
]);
export type ProjectWizardField = z.infer<typeof ProjectWizardField>;

/** Which controls each step owns, in render order. */
export const WIZARD_STEP_FIELDS: Record<ProjectWizardStep, readonly ProjectWizardField[]> = {
	details: ["title", "scope", "format", "currency", "visibility", "attachmentIds"],
	legal: ["ipOwnershipMode", "ndaMode", "portfolioDisplayRights", "languages", "locations"],
	stages: [
		"hasStages",
		"stageName",
		"stageDescription",
		"stageTasks",
		"stageSkills",
		"stageRequiresFiles",
		"stageAllowedFileTypes",
		"stageNdaOverride",
	],
	timeline: [
		"stageDependsOn",
		"stageParallel",
		"stageLagDays",
		"stageDuration",
		"allowDeadlineBonuses",
	],
	budget: ["stageUnitPrice", "stageSeatLimit", "roles"],
	review: [],
};

/**
 * A field's tier, or the pair it resolves to when the engagement's shape decides.
 *
 * Two controls genuinely differ by shape rather than by preference: a one-off's single fee IS the
 * engagement, so it blocks, where a pipeline's per-ticket rate can be set once work is scoped; and a
 * one-off's schedule is the deliverable's due date, where a pipeline's is a per-stage refinement.
 */
export type TierRule = FieldTier | { readonly pipeline: FieldTier; readonly one_off: FieldTier };

/** The tier of every wizard control. */
export const FIELD_TIERS: Record<ProjectWizardField, TierRule> = {
	title: "T1",
	scope: "T2",
	format: "T1",
	currency: "T2",
	visibility: "T2",
	attachmentIds: "T5",
	ipOwnershipMode: "T2",
	ndaMode: "T5",
	portfolioDisplayRights: "T4",
	languages: "T4",
	locations: "T4",
	hasStages: "T2",
	stageName: "T1",
	stageDescription: "T2",
	stageTasks: "T3",
	stageSkills: "T4",
	stageRequiresFiles: "T1",
	stageAllowedFileTypes: "T5",
	stageNdaOverride: "T5",
	stageDependsOn: "T1",
	stageParallel: "T5",
	stageLagDays: "T5",
	stageDuration: { pipeline: "T5", one_off: "T3" },
	allowDeadlineBonuses: "T2",
	stageUnitPrice: { pipeline: "T2", one_off: "T1" },
	stageSeatLimit: "T2",
	roles: "T2",
};

/**
 * Resolve a control's tier for the shape being created.
 *
 * `direct_deliverable` resolves down the `one_off` arm because it IS a one-off — the stage-less
 * variant of one — so a caller never has to remember which of the three members the pair was written
 * for.
 */
export function fieldTier(field: ProjectWizardField, format: ProjectCreateFormat): FieldTier {
	const rule = FIELD_TIERS[field];
	if (typeof rule === "string") return rule;
	return format === "pipeline" ? rule.pipeline : rule.one_off;
}
// #endregion
