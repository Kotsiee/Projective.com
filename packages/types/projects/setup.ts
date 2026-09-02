import { z } from "zod";
import {
	BudgetType,
	CreateProjectStageSchema,
	CurrencyCode,
	IpOwnershipMode,
	NdaMode,
	PortfolioDisplayRights,
	type ProjectCreateFormat,
	ProjectVisibility,
	StageDurationMode,
} from "./create.ts";
import { FileCategory } from "../files/categories.ts";
import { ProjectFormat, ProjectStatus } from "./summary.ts";

/**
 * projects.setup — the Zod SSOT for the project **configuration** projection: what the owner's
 * Details form edits, and what the setup progress bar measures.
 *
 * This exists because {@link ProjectDetailSchema} deliberately carries none of it. Detail is the
 * sidebar's showcase read — it projects identity, the channel tree and the viewer's capabilities, and
 * its fixtures hardcode price/roles/seats empty. A progress bar built on that projection could only
 * ever count a title, so the ladder would read 100% on a project nobody could hire against.
 *
 * The four derivation helpers below are the ONE implementation of the completeness rule. The fat
 * service, the SSR resolver and the island all call them, so the bar the owner reads and the gate
 * that opens Preview are computed from the same code — a percentage recomputed at a second site is a
 * percentage that will eventually disagree with the button it sits beside.
 *
 * `completeness`, `steps` and `previewReady` are therefore SERVER-derived and never trusted from a
 * request body: {@link reconcileSetup} re-derives all three from the data fields and ignores whatever
 * a caller sent for them.
 *
 * Only enum/array/string/number/boolean primitives are used so the schema stays stable across Zod
 * majors (matching the sibling projects schemas).
 */

// #region Structure + session axis
/**
 * The finer shape WITHIN a {@link ProjectFormat}.
 *
 * `format` says how work flows (`one_off | pipeline | session`, the `projects.project_format` enum);
 * this says what the setup form has to collect. The distinction earns its keep in exactly one place:
 * `single_task` is the **Direct Deliverable** — a fixed engagement that takes no stages at all and is
 * staffed by {@link ProjectRoleSetupSchema} roles instead, so its required ladder step is `roles`
 * where every other structure's is `stages`.
 *
 * Note the vocabulary split this bridges: `ProjectCreateFormat` (`./create.ts`) offers
 * `pipeline | one_off | direct_deliverable` at the modal, while the column enum is
 * `one_off | pipeline | session`. A Direct Deliverable is stored as `format: "one_off"` with
 * `structure: "single_task"`, which is what keeps the two vocabularies reconcilable without a third.
 */
export const ProjectStructure = z.enum(["standard", "one_off", "single_task", "single_stage"]);
export type ProjectStructure = z.infer<typeof ProjectStructure>;

/**
 * The two columns a {@link ProjectCreateFormat} resolves to.
 *
 * The ONE implementation of the reconciliation described above: the create write, the setup read and
 * the fixtures all call it, so the three cannot drift into disagreeing about what the client chose.
 *
 * It lives HERE rather than beside `ProjectCreateFormat` in `./create.ts` for a structural reason —
 * `create.ts` is the leaf and this module already depends on it, so defining it there would need an
 * import back the other way and make the pair mutually dependent. That edge survives only while one
 * side stays `import type`, and a module whose corpus builds at import time turns such a cycle into a
 * TDZ crash rather than a style problem.
 *
 * `hasStages` is the wizard's own toggle rather than a third format. An author who turns stages off
 * on a one-off is describing a Direct Deliverable — a fixed engagement staffed by roles — and on a
 * pipeline is describing a single continuous stage, which is what `single_stage` records. The
 * parameter defaults to `true` so every call site written before the toggle existed still resolves to
 * the shape it always did.
 */
export function createFormatToColumns(
	format: ProjectCreateFormat,
	hasStages = true,
): { format: ProjectFormat; structure: ProjectStructure } {
	if (format === "direct_deliverable") return { format: "one_off", structure: "single_task" };
	if (format === "one_off") {
		return { format: "one_off", structure: hasStages ? "one_off" : "single_task" };
	}
	return { format: "pipeline", structure: hasStages ? "standard" : "single_stage" };
}

/**
 * Whether a stored structure has stages — the read direction of {@link createFormatToColumns}.
 *
 * DERIVED, never a column. A `has_stages boolean` beside `structure_variation` would be a second
 * answer able to disagree with the stage list itself, and `projects.set_project_status` already
 * decides against the stage COUNT. `single_task` is the one structure staffed by roles instead, so it
 * is the one that has none.
 */
export function hasStagesFor(structure: ProjectStructure): boolean {
	return structure !== "single_task";
}

/**
 * 1-1 vs group, meaningful only when `format === "session"`.
 *
 * The brief's fourth format `group_session` has no representation in the projects domain — it is a
 * `ServiceType` value in the services/explore domain, and `projects.project_format` is a three-member
 * enum. It resolves here as `format: "session"` + `sessionKind: "group"`, the same axis
 * `apps/web/features/projects/core/session-model.ts` already models (root CLAUDE.md §8 Decision #48),
 * rather than by widening a Postgres enum to carry a distinction the session surfaces already draw.
 */
export const ProjectSessionKind = z.enum(["none", "normal", "group"]);
export type ProjectSessionKind = z.infer<typeof ProjectSessionKind>;
// #endregion

// #region Stage + role configuration
/**
 * How far a stage's own configuration has got.
 *
 * `unitPriceCents` is nullable rather than defaulted to zero because "unpriced" and "free" are
 * different states: the pricing ladder step counts a priced stage, and a stage silently defaulted to
 * 0 would satisfy that step with a number nobody typed.
 *
 * Every field below `skills` is named IDENTICALLY to its counterpart on
 * {@link CreateProjectStageSchema}. The create payload and this projection describe the same stage
 * from opposite ends of one round trip, so a pair that differed by a character would drop the
 * author's answer in between with nothing to report it — a type checker sees two schemas that both
 * parse, and a source-reading review sees two plausible names.
 *
 * They carry no defaults, matching the fields above them: this is a SERVER-built projection and
 * every field is a fact the read path already holds, so an absent value would mean the producer
 * forgot rather than that the author left it blank.
 */
export const StageSetupSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	order: z.number().int().min(0),
	/** Rich scope (semantic HTML). `""` = unscoped. */
	description: z.string().max(8000),
	/** The stage price in minor units — per ticket on a pipeline, the whole fee on a one-off; `null` = unpriced. */
	unitPriceCents: z.number().int().min(0).nullable(),
	/** Free-text delivery note ("2 weeks"). */
	milestone: z.string().max(240),
	skills: z.array(z.string().min(1).max(60)).max(20),
	/** The checklist a ticket raised against this stage is seeded from. Labels only. */
	tasks: z.array(z.string().min(1).max(240)).max(50),
	/** Whether a submission against this stage must carry a file. */
	requiresFiles: z.boolean(),
	/** Seats on this stage; `null` = unlimited. Headcount, not summed workload. */
	seatLimit: z.number().int().min(1).nullable(),
	/** Whether this stage runs alongside the one it depends on rather than after it. */
	parallel: z.boolean(),
	/** The stage this one waits on, as an index into the ordered stage list; `null` = none. */
	dependsOnStageIndex: z.number().int().min(0).nullable(),
	/** Days to wait after the dependency resolves before this stage opens. */
	lagDays: z.number().int().min(0).max(365),
	/** Whether this stage carries confidentiality terms stricter than the project's. */
	ndaOverride: z.boolean(),
	/** Categories a submission may carry; empty = every category. */
	allowedFileCategories: z.array(FileCategory).max(28),
	/** Extensions a submission may carry, without the dot; empty = every extension. */
	allowedFileExtensions: z.array(z.string().min(1).max(16)).max(50),
	/** How this stage's delivery date is expressed. A stored `NULL` reads as `no_due_date`. */
	durationMode: StageDurationMode,
	/** Days from the stage opening, when `durationMode` is `relative_duration`; else `null`. */
	durationDays: z.number().int().min(0).max(3650).nullable(),
	/** The absolute deadline (ISO instant), when `durationMode` is `fixed_deadline`; else `null`. */
	dueDate: z.string().max(40).nullable(),
});
export type StageSetup = z.infer<typeof StageSetupSchema>;

const { name: _seedName, ...stageDefaults } = CreateProjectStageSchema.parse({ name: "Stage" });

/**
 * A stage as it stands before its owner has configured anything but a name.
 *
 * DERIVED from {@link CreateProjectStageSchema}'s own defaults rather than restated, so the value a
 * create writes and the value a projection reports for an unconfigured stage are literally the same
 * object shape. It also makes the identical-naming rule structural: if either schema renames a field,
 * this assignment stops compiling instead of silently producing a projection with a stale key.
 */
export const DEFAULT_STAGE_SETUP: Omit<StageSetup, "id" | "name" | "order"> = stageDefaults;

/** A staffing role on a stage-less (Direct Deliverable) engagement. */
export const ProjectRoleSetupSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	skills: z.array(z.string().min(1).max(60)).max(20),
	/** Role budget in minor units; `null` = unpriced. */
	budgetCents: z.number().int().min(0).nullable(),
});
export type ProjectRoleSetup = z.infer<typeof ProjectRoleSetupSchema>;
// #endregion

// #region Engagement rules
// `ProjectVisibility`, `IpOwnershipMode`, `PortfolioDisplayRights` and `NdaMode` are declared in
// `./create.ts` and imported here. They are terms the wizard offers and the setup form edits, so
// both modules need them, and the leaf is the only place they can live without an import cycle —
// the same reason recorded on `createFormatToColumns` above.

/** How the stages are meant to run against one another. */
export const TimelinePreset = z.enum(["sequential", "simultaneous", "staggered", "custom"]);
export type TimelinePreset = z.infer<typeof TimelinePreset>;

/**
 * The engagement rules that gate hiring — mapped 1:1 onto `projects.projects` columns.
 *
 * Every field carries a real value rather than a nullable "unset", because each one is a term the
 * engagement is offered under and there is no coherent way to hire against an absent answer. An empty
 * `locationRestriction` is the legitimate answer "anywhere", not an omission.
 */
export const ProjectRulesSchema = z.object({
	visibility: ProjectVisibility,
	ipOwnershipMode: IpOwnershipMode,
	/**
	 * The legacy boolean, kept because existing consumers read it. It is DERIVED from `ndaMode` —
	 * `ndaRequiredFor(ndaMode)` — and the fat service keeps the two in step on every write, so a
	 * reader that only knows the boolean still gets the right answer.
	 */
	ndaRequired: z.boolean(),
	/** What governs confidentiality. The authoritative half of the pair above. */
	ndaMode: NdaMode,
	/** The custom NDA document, when `ndaMode` is `custom`; `null` otherwise. */
	ndaDocumentId: z.string().max(64).nullable(),
	portfolioDisplayRights: PortfolioDisplayRights,
	timelinePreset: TimelinePreset,
	allowDeadlineBonuses: z.boolean(),
	locationRestriction: z.array(z.string().min(1).max(60)).max(20),
	languageRequirement: z.array(z.string().min(1).max(60)).max(20),
});
export type ProjectRules = z.infer<typeof ProjectRulesSchema>;

/**
 * The terms a project is created under before its owner has opened the Rules section.
 *
 * `invite_only` rather than `public`: a draft nobody has finished configuring must not be discoverable
 * by default, because the cost of getting that default wrong is a half-written engagement on Explore.
 */
export const DEFAULT_PROJECT_RULES: ProjectRules = {
	visibility: "invite_only",
	ipOwnershipMode: "exclusive_transfer",
	ndaRequired: false,
	ndaMode: "none",
	ndaDocumentId: null,
	portfolioDisplayRights: "allowed",
	timelinePreset: "sequential",
	allowDeadlineBonuses: false,
	locationRestriction: [],
	languageRequirement: [],
};
// #endregion

// #region Budget
/**
 * Project-level budget. `amountCents` `null` = not set, which is distinct from zero — the pricing
 * ladder step counts a number the owner supplied, and a defaulted 0 would satisfy it silently.
 */
export const ProjectBudgetSchema = z.object({
	budgetType: BudgetType,
	amountCents: z.number().int().min(0).nullable(),
	currency: CurrencyCode,
});
export type ProjectBudget = z.infer<typeof ProjectBudgetSchema>;

/** The budget a project carries before anyone has typed a number into it. */
export const DEFAULT_PROJECT_BUDGET: ProjectBudget = {
	budgetType: "fixed_price",
	amountCents: null,
	currency: "USD",
};
// #endregion

// #region The setup ladder
/** Which requirement a ladder row measures. */
export const ProjectSetupStepKey = z.enum([
	"title",
	"format",
	"description",
	"pricing",
	"stages",
	"roles",
	"rules",
	"publish",
]);
export type ProjectSetupStepKey = z.infer<typeof ProjectSetupStepKey>;

/**
 * One requirement on the setup ladder — the progress bar's unit.
 *
 * `required` is the narrower set the Preview toggle waits on (Title · Format · Pricing · one staffing
 * step), so a project can read well short of 100% and still be previewable. Conflating the two would
 * make the bar the gate, and an owner would be blocked from previewing by an optional field.
 *
 * Named with the domain prefix because `packages/types/workspace/workspace.ts` already exports a
 * DIFFERENT `SetupStep` — an onboarding checklist row, keyed `logo | bio | …` and carrying `note`
 * and `href`. The two never meet today only because the package barrel re-exports seven of its
 * eighteen domains and `workspace` is not one of them; sharing the bare name would make an unrelated
 * `export * from "./workspace/mod.ts"` a duplicate-export error, in a file neither author was
 * editing.
 */
export const ProjectSetupStepSchema = z.object({
	key: ProjectSetupStepKey,
	label: z.string().min(1).max(60),
	/** Whether this step is satisfied. */
	done: z.boolean(),
	/** Whether the Preview toggle waits on it. */
	required: z.boolean(),
	/** What to do about it, when not done. Shown as the step's hint; `""` once there is nothing to do. */
	hint: z.string().max(160),
});
export type ProjectSetupStep = z.infer<typeof ProjectSetupStepSchema>;

/**
 * The section heading a format gives its stage list. One rule, so the ladder row, the form section
 * and the empty state cannot each invent their own noun for the same list.
 */
export const STAGE_SECTION_LABEL: Record<ProjectFormat, string> = {
	pipeline: "Stages",
	one_off: "Milestones",
	session: "Sessions",
};

/** The singular of {@link STAGE_SECTION_LABEL}, for hints that address one row of the list. */
export const STAGE_ITEM_LABEL: Record<ProjectFormat, string> = {
	pipeline: "stage",
	one_off: "milestone",
	session: "session",
};

/** The section heading for the staffing list a Direct Deliverable takes instead of stages. */
export const ROLE_SECTION_LABEL = "Team roles";
// #endregion

// #region The setup projection
/** The whole editable configuration plus its derived completeness. */
export const ProjectSetupSchema = z.object({
	slug: z.string().min(1).max(120),
	title: z.string().max(160),
	format: ProjectFormat,
	structure: ProjectStructure,
	sessionKind: ProjectSessionKind,
	status: ProjectStatus,
	/**
	 * When this engagement was soft-archived, or `null`.
	 *
	 * Its own field rather than a `status` member, because `ProjectStatus` has no `archived` and the
	 * database's `project_status` does — a projection that folded the two would have to answer "is
	 * this archived?" with a lifecycle state that means something else. Archiving is a decision about
	 * whether the row is live at all, and it is what tells the setup surface to stop offering edits
	 * the write path will refuse with a 409.
	 */
	archivedAt: z.string().max(40).nullable().default(null),
	description: z.string().max(8000),
	budget: ProjectBudgetSchema,
	rules: ProjectRulesSchema,
	stages: z.array(StageSetupSchema).max(50),
	roles: z.array(ProjectRoleSetupSchema).max(20),
	/** Re-derived server-side; never trusted from the client (root CLAUDE.md §6). */
	viewerIsClient: z.boolean(),
	/** The ladder, in display order. */
	steps: z.array(ProjectSetupStepSchema),
	/** 0..100, integer. Server-computed so the bar and the gate cannot disagree. */
	completeness: z.number().int().min(0).max(100),
	/** Whether every `required` step is done — the Preview toggle's enable gate. */
	previewReady: z.boolean(),
});
export type ProjectSetup = z.infer<typeof ProjectSetupSchema>;

/**
 * The data half of a setup: everything a caller supplies, with the three derived fields removed.
 *
 * They are removed at the TYPE level rather than merely ignored at runtime, so a caller that tries to
 * hand {@link reconcileSetup} a completeness fails to compile instead of being quietly overruled.
 */
export type ProjectSetupInput = Omit<ProjectSetup, "steps" | "completeness" | "previewReady">;

/**
 * What a PATCH may carry.
 *
 * `budget` and `rules` are DEEP-partial because that is what {@link UpdateProjectSchema} actually puts
 * on the wire — a form section that sends one changed rule sends one field, and typing the parameter
 * as a whole {@link ProjectRules} would force every caller through a cast, which is how a fold that
 * merges correctly at runtime ends up being called with a blanked object.
 */
export type ProjectSetupPatch =
	& Omit<Partial<ProjectSetupInput>, "budget" | "rules">
	& { budget?: Partial<ProjectBudget>; rules?: Partial<ProjectRules> };
// #endregion

// #region Derivation
/** The subset {@link setupSteps} reads. `status` is optional; absent reads as a draft. */
export type ProjectSetupStepsInput = {
	title: string;
	format: ProjectFormat;
	structure: ProjectStructure;
	description: string;
	budget: ProjectBudget;
	stages: readonly StageSetup[];
	roles: readonly ProjectRoleSetup[];
	rules: ProjectRules;
	status?: ProjectStatus;
};

/**
 * Whether a rich-text field carries actual prose.
 *
 * An emptied `RichTextEditor` does not emit `""` — it emits markup such as `<p><br></p>`, which is
 * non-empty to `trim()` and would tick the description step off for a project whose scope nobody has
 * written. Tags and entity whitespace are stripped before the emptiness test so the ladder measures
 * what a reader would see rather than what the editor happened to serialise.
 */
function hasProse(value: string): boolean {
	return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim().length > 0;
}

/** Whether the engagement is staffed by roles rather than by stages. */
function staffedByRoles(structure: ProjectStructure): boolean {
	return structure === "single_task";
}

/**
 * Build the ladder from a configuration.
 *
 * The `required` set is Title · Format · Pricing · one staffing step. `format` is required AND
 * satisfied from creation: it carries a default at the create modal, so it is what "pre-fill baseline
 * progress from the creation modal" means rather than a step the owner has to go and do.
 *
 * `rules` is the same class — every field in {@link ProjectRulesSchema} carries a real term and an
 * empty restriction list is a legitimate answer, so the row records that the terms exist rather than
 * pretending emptiness is incompleteness. It stays on the ladder because the form has a Rules section
 * and a section with no row would read as an omission from the ladder itself.
 */
export function setupSteps(input: ProjectSetupStepsInput): ProjectSetupStep[] {
	const byRoles = staffedByRoles(input.structure);
	const stageLabel = STAGE_SECTION_LABEL[input.format];
	const stageItem = STAGE_ITEM_LABEL[input.format];
	const stagesPriced = input.stages.some((s) => s.unitPriceCents !== null);
	const rolesPriced = input.roles.some((r) => r.budgetCents !== null);
	const priced = input.budget.amountCents !== null || stagesPriced || rolesPriced;

	const steps: ProjectSetupStep[] = [
		{
			key: "title",
			label: "Title",
			done: input.title.trim().length > 0,
			required: true,
			hint: "Give the project a name.",
		},
		{
			key: "format",
			label: "Project type",
			done: true,
			required: true,
			hint: "",
		},
		{
			key: "description",
			label: "Description",
			done: hasProse(input.description),
			required: false,
			hint: "Describe the work so a freelancer can judge whether they fit it.",
		},
		{
			key: "pricing",
			label: "Pricing",
			done: priced,
			required: true,
			hint: byRoles
				? "Set a project budget, or give at least one role a budget."
				: `Set a project budget, or price at least one ${stageItem}.`,
		},
		byRoles
			? {
				key: "roles" as const,
				label: ROLE_SECTION_LABEL,
				done: input.roles.length > 0,
				required: true,
				hint: "Add at least one team role.",
			}
			: {
				key: "stages" as const,
				label: stageLabel,
				done: input.stages.length > 0,
				required: true,
				hint: `Add at least one ${stageItem}.`,
			},
		{
			key: "rules",
			label: "Rules",
			done: true,
			required: false,
			hint: "",
		},
		{
			key: "publish",
			label: "Publish",
			done: input.status !== undefined && input.status !== "draft",
			required: false,
			hint: "Publish once the required steps are done.",
		},
	];

	return steps;
}

/**
 * The share of the ladder that is done, 0..100.
 *
 * Rounded to an integer at the one place it is computed, because the bar's `aria-valuenow`, its
 * visible `NN%` and its geometry must all be the same number — three roundings of one float are three
 * chances to print a percentage the bar does not draw.
 */
export function setupCompleteness(steps: readonly ProjectSetupStep[]): number {
	if (steps.length === 0) return 0;
	const done = steps.reduce((n, step) => n + (step.done ? 1 : 0), 0);
	return Math.round((done / steps.length) * 100);
}

/** Whether every `required` step is done — the Preview toggle's enable gate. */
export function previewReady(steps: readonly ProjectSetupStep[]): boolean {
	return steps.every((step) => !step.required || step.done);
}

/** The steps still standing between the owner and Preview — the locked control's tooltip reads these. */
export function outstandingSteps(steps: readonly ProjectSetupStep[]): ProjectSetupStep[] {
	return steps.filter((step) => step.required && !step.done);
}

/**
 * The visibility an engagement is actually STORED under, given what the author asked for.
 *
 * A discoverable engagement is a promise to the freelancers who find it, so the request is honoured
 * only once every required step is done; until then the project stays `unlisted` — reachable by its
 * own owner and by anyone holding the link, and absent from Explore. That is why a freshly created
 * project is never public no matter what the wizard's control said: it has satisfied nothing yet.
 *
 * It is computed HERE, beside the ladder, and called by BOTH the wizard's disclosure and the fat
 * service that writes the row, so the sentence an author reads under the control and the value the
 * database receives are the same decision rather than two implementations that agree today. It is
 * never computed on the client alone — a client that decided its own visibility would be deciding
 * its own reach.
 *
 * `unlisted` is returned rather than the author's choice being rejected: a refusal would block a
 * draft, and the whole point of the ladder is that a project can be saved long before it is offered.
 */
export function effectiveVisibility(
	requested: ProjectVisibility,
	steps: readonly ProjectSetupStep[],
): ProjectVisibility {
	return previewReady(steps) ? requested : "unlisted";
}

/**
 * The widest reach a CREATE may ever store, whatever its author asked for and however complete the
 * payload is.
 *
 * `projects.create_project` hardcodes `unlisted` and ignores the payload's visibility entirely: the
 * function is `EXECUTE`-granted to `authenticated`, so a caller reaching it directly over PostgREST
 * was once able to publish a project in the act of naming it. Publication is a later, deliberate
 * write that goes through the setup path, where {@link effectiveVisibility} measures the ladder
 * against what is actually stored.
 */
export const CREATED_PROJECT_VISIBILITY: ProjectVisibility = "unlisted";

/**
 * How far each visibility reaches, widest first.
 *
 * An ordering rather than a set, because the ceiling is a statement about REACH — a create may never
 * make a project more discoverable than {@link CREATED_PROJECT_VISIBILITY} — and a set could only
 * express "is it this one".
 */
const VISIBILITY_REACH: Record<ProjectVisibility, number> = {
	public: 2,
	unlisted: 1,
	invite_only: 0,
};

/**
 * The visibility a CREATE actually stores, given what its author asked for.
 *
 * {@link effectiveVisibility} answers the question for a project that already exists, where the
 * ladder is the only gate. A create has a second one, and the two are different rules: the ladder IS
 * satisfiable in a single payload — a title, a format, a described and priced stage — so
 * `effectiveVisibility` alone returns `public` for a well-filled wizard while both write paths store
 * `unlisted`. Anything reading the first rule on a creation surface therefore states the opposite of
 * what will happen, which is worse than saying nothing.
 *
 * So this is the rule the wizard's disclosure and both create branches call, and it is here rather
 * than in the backend because the surface that has to EXPLAIN a create cannot import the module that
 * performs one.
 *
 * The cap is one-directional, on reach alone. A request NARROWER than the ceiling — `invite_only` —
 * is honoured, because refusing an author's stricter choice would be the cap working against the
 * thing it protects.
 */
export function createdVisibility(
	requested: ProjectVisibility,
	steps: readonly ProjectSetupStep[],
): ProjectVisibility {
	const earned = effectiveVisibility(requested, steps);
	return VISIBILITY_REACH[earned] > VISIBILITY_REACH[CREATED_PROJECT_VISIBILITY]
		? CREATED_PROJECT_VISIBILITY
		: earned;
}

/**
 * Fold a patch over a base and re-derive the ladder, the percentage and the gate in one place.
 *
 * The derived trio is ALWAYS recomputed from the data fields; a client that posts
 * `completeness: 100` is overruled rather than believed, which is the whole reason this is one
 * function instead of three call sites. `budget` and `rules` fold field-by-field so a PATCH carrying
 * one rule does not blank the other seven; `stages` and `roles` replace wholesale, because their
 * create/update/remove reconciliation is an identity question the fat service answers against the
 * database and cannot be inferred from two arrays here.
 */
export function reconcileSetup(
	base: ProjectSetupPatch,
	patch: ProjectSetupPatch = {},
): ProjectSetup {
	const merged: ProjectSetupInput = {
		slug: patch.slug ?? base.slug ?? "",
		title: patch.title ?? base.title ?? "",
		format: patch.format ?? base.format ?? "pipeline",
		structure: patch.structure ?? base.structure ?? "standard",
		sessionKind: patch.sessionKind ?? base.sessionKind ?? "none",
		status: patch.status ?? base.status ?? "draft",
		// `?? null` rather than `??` down a chain: an archive is a fact about the row, and a patch that
		// does not mention it must not clear it.
		archivedAt: patch.archivedAt ?? base.archivedAt ?? null,
		description: patch.description ?? base.description ?? "",
		budget: {
			...DEFAULT_PROJECT_BUDGET,
			...(base.budget ?? {}),
			...(patch.budget ?? {}),
		},
		rules: {
			...DEFAULT_PROJECT_RULES,
			...(base.rules ?? {}),
			...(patch.rules ?? {}),
		},
		stages: patch.stages ?? base.stages ?? [],
		roles: patch.roles ?? base.roles ?? [],
		viewerIsClient: patch.viewerIsClient ?? base.viewerIsClient ?? false,
	};

	const steps = setupSteps(merged);
	return {
		...merged,
		steps,
		completeness: setupCompleteness(steps),
		previewReady: previewReady(steps),
	};
}
// #endregion

// #region Write payloads
/**
 * The PUT/PATCH body.
 *
 * Every field is optional so one schema serves both verbs: a PATCH sends the section that changed, a
 * PUT sends the whole form. `status` deliberately omits `archived` — archiving is a DELETE, so an
 * ordinary edit cannot take a project out of circulation by writing one enum value.
 *
 * A stage or role whose `id` is absent, or begins with `stage-draft-`/`role-draft-`, is a CREATE; a
 * real id is an UPDATE; an existing id missing from the array is a REMOVE. That reconciliation is the
 * fat service's, not this schema's — the wire shape only has to make the three cases expressible.
 */
export const UpdateProjectSchema = z.object({
	title: z.string().min(1).max(160).optional(),
	format: ProjectFormat.optional(),
	structure: ProjectStructure.optional(),
	sessionKind: ProjectSessionKind.optional(),
	description: z.string().max(8000).optional(),
	budget: ProjectBudgetSchema.partial().optional(),
	rules: ProjectRulesSchema.partial().optional(),
	status: z.enum(["draft", "active", "on_hold"]).optional(),
	stages: z.array(
		StageSetupSchema.partial().extend({ id: z.string().max(80).optional() }),
	).max(50).optional(),
	roles: z.array(
		ProjectRoleSetupSchema.partial().extend({ id: z.string().max(80).optional() }),
	).max(20).optional(),
});
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

/**
 * The DELETE body — a soft archive, never a row removal (root CLAUDE.md §5). The reason is optional
 * because a project archived without one is still archived; refusing the action for want of a
 * sentence would only teach owners to type a full stop.
 */
export const ArchiveProjectSchema = z.object({
	reason: z.string().max(400).optional(),
});
export type ArchiveProject = z.infer<typeof ArchiveProjectSchema>;
// #endregion
