import { z } from "zod";
import {
	BudgetType,
	CurrencyCode,
	IpOwnershipMode,
	PortfolioDisplayRights,
	type ProjectCreateFormat,
	ProjectVisibility,
} from "./create.ts";
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
 * `hasStages` is a toggle on the setup form rather than a third format. An author who turns stages
 * off on a one-off is describing a Direct Deliverable — a fixed engagement staffed by roles — and on
 * a pipeline is describing a single continuous stage, which is what `single_stage` records. That is
 * the whole reason {@link ProjectCreateFormat} offers two members and not three: `direct_deliverable`
 * was a third create vocabulary that had to be stored as `one_off` + `single_task` anyway, so the
 * mapping onto `projects.project_format` is now the identity function and the distinction survives
 * one level down, on the axis that actually records it. The parameter defaults to `true` so every
 * call site written before the toggle existed still resolves to the shape it always did.
 */
export function createFormatToColumns(
	format: ProjectCreateFormat,
	hasStages = true,
): { format: ProjectFormat; structure: ProjectStructure } {
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
 */
/**
 * How a stage starts relative to the one before it — `projects.project_stages.start_trigger_type`.
 *
 * Two members, not the column's full set: this is the only distinction the setup form asks a client
 * to make, and it is the one that changes what the board draws. `sequential` waits for the previous
 * stage; `parallel` starts with the project and runs alongside it.
 */
export const StageDependency = z.enum(["sequential", "parallel"]);
export type StageDependency = z.infer<typeof StageDependency>;

/**
 * Whether a stage takes as many providers as apply, or a fixed number.
 *
 * TWO fields rather than one nullable count, because "unlimited" is an ANSWER and not an absence. A
 * single `seatCount: number | null` would make the deliberate choice of an open stage
 * indistinguishable from a client who has not decided yet, and the seat meter would have to render
 * the same thing for both. The pairing invariant — a `limited` stage carries a count, an
 * `unlimited` one does not — is held by {@link normaliseSeats}, mirroring the bidirectional CHECK
 * the column pair carries in `00000015_tables_projects.sql`.
 *
 * Named `StageCapacity` and not `StageSeatKind` because `@projective/types/explore` already owns
 * that name for a DIFFERENT axis — `"seats" | "roles"`, the opening STRUCTURE a public listing
 * advertises. One name for two concepts is exactly the defect §B.7.7 gates against, and here the
 * barrel would have caught it as a duplicate export anyway. This one answers "how many", that one
 * answers "shaped how".
 */
export const StageCapacity = z.enum(["unlimited", "limited"]);
export type StageCapacity = z.infer<typeof StageCapacity>;

/** The seat count a `limited` stage takes before anyone has moved the stepper. */
/**
 * How many skills one stage may require, and how long each may be.
 *
 * Named because three places have to agree on them — this schema, the read that projects a stored
 * row, and the write that clamps an incoming one. Three literals is three chances for the read to
 * truncate at a length the write allows, which silently shortens a skill nobody asked to change.
 */
export const MAX_STAGE_SKILLS = 10;
export const SKILL_LABEL_MAX = 60;

/** How long a stage's milestone label may be. `project_stages.milestone` is `NOT NULL DEFAULT `. */
export const MILESTONE_MAX = 240;

export const DEFAULT_STAGE_SEATS = 3;

/** One checklist item on a stage's default task list (`project_stages.default_tasks`). */
export const StageTaskSchema = z.object({
	id: z.string().min(1).max(80),
	text: z.string().min(1).max(240),
});
export type StageTask = z.infer<typeof StageTaskSchema>;

/**
 * A staffing role scoped to ONE stage — named for its table, `projects.stage_staffing_roles`.
 *
 * Distinct from {@link ProjectRoleSetupSchema}, which staffs a stage-LESS engagement. The two look
 * alike and are not interchangeable: this one hangs off a `project_stage_id` and there may be
 * several per project; that one exists precisely because there is no stage to hang anything off.
 *
 * Also distinct from `@projective/types/explore`'s `StageRole`, which is the PUBLIC projection of
 * the same idea — a name, an open-seat count and a display price for a listing a stranger is
 * reading. This is the owner's editable row, and it carries a budget the public one must never see.
 */
export const StageStaffingRoleSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	/** How many providers this role takes. */
	quantity: z.number().int().min(1).max(99),
	/** Role budget in minor units; `null` = unpriced. */
	budgetCents: z.number().int().min(0).nullable(),
});
export type StageStaffingRole = z.infer<typeof StageStaffingRoleSchema>;

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
	/**
	 * Required skills, capped at TEN.
	 *
	 * The cap is a product rule, not a storage limit: a stage asking for twenty skills is asking for
	 * nobody, and the discovery ranker weights a skill list by its precision. Ten is the ceiling the
	 * Stage-2 chip editor enforces and the schema refuses past.
	 */
	/**
	 * Required skills, capped at {@link MAX_STAGE_SKILLS}.
	 *
	 * `.trim()` before `.min(1)` deliberately: a `Chips` control yields whatever was typed, and
	 * `z.string().min(1)` accepts a single space. A whitespace skill matches nothing, renders as a
	 * blank pill, and still occupies one of the ten slots.
	 */
	skills: z.array(z.string().trim().min(1).max(SKILL_LABEL_MAX)).max(MAX_STAGE_SKILLS),
	/** The default checklist a ticket on this stage is seeded from. */
	tasks: z.array(StageTaskSchema).max(50),
	/** Whether this stage waits for its predecessor or runs alongside the project. */
	dependency: StageDependency,
	/** Working days this stage is expected to take; `null` = open-ended. */
	durationDays: z.number().int().min(1).max(3650).nullable(),
	/** Open to as many providers as apply, or a fixed count. */
	capacity: StageCapacity,
	/** How many seats when `capacity === "limited"`; `null` when unlimited. */
	seatCount: z.number().int().min(1).max(99).nullable(),
	/** Named roles this stage staffs. Empty = an unnamed pool governed by the seat settings alone. */
	roles: z.array(StageStaffingRoleSchema).max(20),
	/**
	 * File kinds a submission to this stage may carry. EMPTY MEANS ANY — the permissive answer, not
	 * an unanswered one, so a stage nobody has configured never silently refuses a deliverable.
	 */
	allowedFileKinds: z.array(z.string().min(1).max(32)).max(20),
	/**
	 * Per-stage NDA override. `null` INHERITS the project's `ndaRequired`.
	 *
	 * Nullable rather than a boolean copied down from the project, because a copied default goes
	 * stale the moment the project-level term changes and nothing would then say which of the two the
	 * stage actually meant.
	 */
	ndaRequired: z.boolean().nullable(),
});
export type StageSetup = z.infer<typeof StageSetupSchema>;

/** A staffing role on a stage-less (Direct Deliverable) engagement. */
export const ProjectRoleSetupSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	skills: z.array(z.string().min(1).max(60)).max(20),
	/** Role budget in minor units; `null` = unpriced. */
	budgetCents: z.number().int().min(0).nullable(),
});
export type ProjectRoleSetup = z.infer<typeof ProjectRoleSetupSchema>;

/**
 * Hold the seat pair to its invariant: a `limited` stage carries a count, an `unlimited` one
 * carries `null`.
 *
 * One function, so the form, the fold and the fat service cannot each decide differently what an
 * unlimited stage's count is. Switching back to `limited` restores the count the caller was
 * holding rather than resetting to the default, so toggling a stage open and shut again does not
 * silently discard a number the owner typed.
 */
export function normaliseSeats(
	capacity: StageCapacity,
	count: number | null,
): { capacity: StageCapacity; seatCount: number | null } {
	if (capacity === "unlimited") return { capacity: "unlimited", seatCount: null };
	return { capacity: "limited", seatCount: count ?? DEFAULT_STAGE_SEATS };
}

/** The configuration a freshly added stage carries. */
export function blankStage(id: string, name: string, order: number): StageSetup {
	return {
		id,
		name,
		order,
		description: "",
		unitPriceCents: null,
		milestone: "",
		skills: [],
		tasks: [],
		dependency: "sequential",
		durationDays: null,
		capacity: "unlimited",
		seatCount: null,
		roles: [],
		allowedFileKinds: [],
		ndaRequired: null,
	};
}

/**
 * A stage's configuration before its owner has touched anything but its name.
 *
 * DERIVED from {@link blankStage} by stripping its identity, rather than restated as a second
 * literal. The two would be a pair of answers to one question — what does an unconfigured stage
 * hold — and a field added to `StageSetupSchema` would land in whichever of them the author
 * remembered, with the other quietly reporting a stale shape that still type-checks.
 *
 * `id`, `name` and `order` are removed because they are the caller's, not the default's: every one
 * of them differs per stage, and a default that carried them would invite a spread that silently
 * pinned two stages to the same identity.
 */
export const DEFAULT_STAGE_SETUP: Omit<StageSetup, "id" | "name" | "order"> = (() => {
	const { id: _id, name: _name, order: _order, ...rest } = blankStage("", "", 0);
	return rest;
})();
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
/**
 * Which NDA a project is offered under.
 *
 * `platform` is Projective's standard mutual NDA — the answer that needs no upload and no legal
 * review, and therefore the default. `custom` names a file the client supplies. An enum rather than
 * "a nullable document id where null means platform", so that a client who INTENDED to attach their
 * own and has not uploaded it yet is a state the form can hold and warn about, instead of silently
 * reading as the platform standard.
 */
export const NdaDocumentSource = z.enum(["platform", "custom"]);
export type NdaDocumentSource = z.infer<typeof NdaDocumentSource>;

export const ProjectRulesSchema = z.object({
	/**
	 * Where this engagement should sit **once it publishes** — the owner's intent, not where the row
	 * sits today.
	 *
	 * The distinction is load-bearing and it is the reason there are two fields. A draft is minted
	 * `unlisted` so nothing half-written can reach Explore, and it must STAY that way for as long as
	 * it is a draft — but the owner has to be able to answer "and when it goes live, who sees it?"
	 * while it is still a draft, which is the only moment they are actually looking at the form. One
	 * column cannot hold both answers: writing the intent to it publishes the draft, and refusing the
	 * write leaves a dropdown that reverts to a value nobody chose.
	 *
	 * So this is the intent, stored on its own column (`projects.projects.publish_visibility`), and
	 * {@link ProjectSetupSchema.liveVisibility} is where the row actually is. The promotion from one
	 * to the other is {@link liveVisibilityFor}, applied server-side on the status transition — never
	 * by the client, which may state an intent and may not decide when it takes effect.
	 */
	visibility: ProjectVisibility,
	ipOwnershipMode: IpOwnershipMode,
	/**
	 * The legacy boolean, kept because existing consumers read it. It is DERIVED from `ndaMode` —
	 * `ndaRequiredFor(ndaMode)` — and the fat service keeps the two in step on every write, so a
	 * reader that only knows the boolean still gets the right answer.
	 */
	ndaRequired: z.boolean(),
	/** Which NDA applies when `ndaRequired`. Meaningless, and ignored, when it is false. */
	ndaSource: NdaDocumentSource,
	/** The `files.items` id of a custom NDA; `null` while `ndaSource === "platform"`. */
	ndaDocumentId: z.string().max(80).nullable(),
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
 * `invite_only` rather than `public`: this is the fallback for a projection reconstructed with no
 * create event behind it, where nobody chose anything — and guessing `public` there would be
 * inventing consent. A project that WAS created through the Quick-Init modal overrides it with
 * `public`, because somebody creating a project to hire against is asking to be found; that is a real
 * default expressing a real choice, and it is safe precisely because
 * {@link ProjectRules.visibility} is intent rather than state.
 */
export const DEFAULT_PROJECT_RULES: ProjectRules = {
	visibility: "invite_only",
	ipOwnershipMode: "exclusive_transfer",
	ndaRequired: false,
	ndaSource: "platform",
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

/**
 * A reference file the client hangs off the project — a brief, a brand sheet, a spec.
 *
 * Carried by reference (`files.items.id`) rather than by URL, because an asset on this platform is
 * one row with one owner and one privacy scope, and a project attachment is a SECOND surface onto an
 * asset that may also be a submission deliverable or a profile banner. Copying it would give the
 * same bytes two lifetimes.
 */
export const ProjectAttachmentSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(240),
	/** Byte size, for the size column; `null` when the store has not reported one. */
	sizeBytes: z.number().int().min(0).nullable(),
});
export type ProjectAttachment = z.infer<typeof ProjectAttachmentSchema>;

/**
 * How many reference files a project may carry.
 *
 * A product rule rather than a storage limit: past a handful, a "reference" pack stops being read
 * and the brief should carry the detail instead.
 */
export const MAX_PROJECT_ATTACHMENTS = 10;
// #endregion

// #region The setup projection
/** The whole editable configuration plus its derived completeness. */
export const ProjectSetupSchema = z.object({
	/**
	 * The canonical identity — `projects.projects.id`.
	 *
	 * Every `/projects` route now addresses an engagement by this uuid, so the projection has to
	 * carry it: without it the surface can only echo back whatever string was in the URL, and the
	 * client store's re-seed guard has nothing stable to key on. A uuid cannot collide, cannot be
	 * squatted, and — unlike the slug beside it — does not change when the owner renames the project.
	 */
	id: z.string().min(1).max(80),
	/**
	 * The readable alternate address. Retained as a read key, never as the canonical one: a
	 * title-derived slug moves on the first rename, and a link that dies on a rename is not an
	 * address.
	 */
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
	/** Reference files, capped at {@link MAX_PROJECT_ATTACHMENTS}. */
	attachments: z.array(ProjectAttachmentSchema).max(MAX_PROJECT_ATTACHMENTS),
	budget: ProjectBudgetSchema,
	rules: ProjectRulesSchema,
	/**
	 * Where the row sits **right now** — `projects.projects.visibility`, read-only here.
	 *
	 * The counterpart to {@link ProjectRules.visibility}, which is the intent. This one is never sent
	 * by the client and never taken from a payload: it is derived server-side by
	 * {@link liveVisibilityFor} from the status and the stored intent, so a client cannot publish a
	 * draft by asserting that it is already public.
	 *
	 * It exists so the surface can be honest about the gap. Without it the form could show the intent
	 * and nothing else, and an owner reading "Public" on a draft would reasonably conclude their
	 * half-written project was already on Explore.
	 */
	liveVisibility: ProjectVisibility.default("unlisted"),
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
 * Whether this engagement breaks its work into stages at all.
 *
 * Expressed through the EXISTING `structure` axis rather than as a new boolean, because
 * `projects.structure_variation` already carries `single_stage` for exactly this and a parallel
 * flag would be a second answer to one question — the pair would eventually disagree, and nothing
 * would say which one the board should believe.
 *
 * When it is false the project's own description and price ARE the single unit of execution: the
 * service still provisions one root stage so tickets, submissions and escrow have somewhere to
 * hang, but the setup form stops asking the owner to think about it.
 */
export function hasStages(structure: ProjectStructure): boolean {
	return structure !== "single_stage" && structure !== "single_task";
}

/**
 * The structure a project takes when the owner flips the Has-stages toggle.
 *
 * Returns `standard` rather than restoring whatever multi-stage structure was there before, because
 * `one_off` and `standard` differ in how a FORMAT presents its list and that is re-derived from
 * the format on the next render anyway. `single_task` is deliberately unreachable from here: it is
 * a role-staffed engagement, which is a staffing decision and not a stage-count one.
 */
export function structureForStages(on: boolean, format: ProjectFormat): ProjectStructure {
	if (!on) return "single_stage";
	return format === "one_off" ? "one_off" : "standard";
}

/**
 * The structure a format's Shape control writes when a given segment is pressed.
 *
 * This lives in the SSOT rather than inline in the form's handler because the handler got it wrong in a
 * way nothing could catch: it called `structureForStages(true, "one_off")` with both arguments as
 * LITERALS, so every segment of every format wrote `one_off`. On a pipeline, "Single stage" could not
 * produce `single_stage` at all — the control was focusable, looked live, and set the wrong column —
 * and `shapeOf` then failed to match `one_off` against the pipeline's own options and fell back to
 * "Staged", so the segment snapped back and the corruption was invisible.
 *
 * Expressed as a total function of (format, chosen value) so the round trip
 * `shapeFor(format, structureForShape(format, v)) === v` is a property a test can hold, which is
 * exactly the invariant the literal-argument bug broke.
 */
export function structureForShape(format: ProjectFormat, value: string): ProjectStructure {
	if (value === "single_task") return "single_task";
	return structureForStages(value !== "single_stage", format);
}

/**
 * The Shape segments a format offers, in order — empty when it offers no choice.
 *
 * A `session` has none: a sitting is not divisible into stages, so the control is ABSENT rather than
 * rendered with a single option, which would state a decision its author never made.
 */
export function shapeOptionsFor(format: ProjectFormat): readonly ProjectStructure[] {
	if (format === "pipeline") return ["standard", "single_stage"];
	if (format === "one_off") return ["one_off", "single_task"];
	return [];
}

/**
 * Which segment reads as pressed, given what is stored.
 *
 * `format` and `structure` are two columns that can legitimately disagree for a moment — a pipeline
 * whose owner has just switched it to a one-off still carries `standard` — so this resolves rather than
 * trusts, and falls back to the format's first shape so the control never renders with nothing selected.
 */
export function shapeFor(format: ProjectFormat, structure: ProjectStructure): ProjectStructure {
	const options = shapeOptionsFor(format);
	if (options.length === 0) return structure;
	return options.includes(structure) ? structure : options[0];
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
				// A stage-less engagement satisfies this the moment it is declared stage-less: the
				// project itself IS the unit of execution, so there is nothing outstanding to add. Left
				// as `required` either way, so the ladder keeps one staffing row rather than growing and
				// shrinking as the toggle moves — a ladder whose LENGTH changes makes its own percentage
				// jump for a reason the reader cannot see.
				done: !hasStages(input.structure) || input.stages.length > 0,
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
 * Where a project's row sits, given its lifecycle state and its owner's stated intent.
 *
 * The single definition of the promotion, called by the create insert, by the update path's
 * post-transition reconcile, and by the stub write-store — so the three cannot disagree about when a
 * project becomes findable. Total and pure: it takes no view of whether the transition it is being
 * asked about is legal, which is `projects.set_project_status`'s job.
 *
 * A draft is `unlisted` unconditionally, and that is the whole safety property: it does not consult
 * the intent, does not consult {@link previewReady}, and cannot be talked out of it by a payload. A
 * project that is anything else takes the intent verbatim — including on the way BACK to draft, which
 * re-hides it, because a project pulled out of circulation should not stay on Explore.
 *
 * Note what this deliberately does NOT do: it never promotes on readiness alone. A complete draft is
 * still a draft, and publishing is an act the owner performs, not a threshold they cross.
 */
export function liveVisibilityFor(
	status: ProjectStatus,
	intent: ProjectVisibility,
): ProjectVisibility {
	return status === "draft" ? "unlisted" : intent;
}

/**
 * The publish intent a project created through the Quick-Init modal starts with.
 *
 * Its own constant rather than a literal at each site, because the live insert, the created-project
 * projection and the stub write-store all have to agree — and a `public` typed three times is three
 * places for the default to drift, on the one field where drift means a project is either invisible
 * to the people meant to bid on it or visible before it was ready.
 *
 * Deliberately NOT {@link DEFAULT_PROJECT_RULES}`.visibility` (`invite_only`), which is the fallback
 * for a projection reconstructed with no create event behind it. Here a person really did just create
 * a project in order to hire against it, so `public` expresses their evident intent rather than
 * guessing at it — and it is safe to default because {@link liveVisibilityFor} will not let it take
 * effect while the project is a draft.
 */
export const CREATED_PUBLISH_VISIBILITY: ProjectVisibility = "public";

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
		id: patch.id ?? base.id ?? "",
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
		attachments: patch.attachments ?? base.attachments ?? [],
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
		// Re-derived, never folded. `liveVisibility` is a function of the status and the intent, so
		// accepting it from either side would let a stale base — or a client patch — assert a row
		// state that contradicts the status sitting next to it in the same object.
		liveVisibility: liveVisibilityFor(
			patch.status ?? base.status ?? "draft",
			patch.rules?.visibility ?? base.rules?.visibility ??
				DEFAULT_PROJECT_RULES.visibility,
		),
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
	attachments: z.array(ProjectAttachmentSchema).max(MAX_PROJECT_ATTACHMENTS).optional(),
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
