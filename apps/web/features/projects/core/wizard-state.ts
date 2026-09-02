import { computed, type ReadonlySignal, signal } from "@preact/signals";
import {
	blocksPosting,
	type CreateProject,
	CreateProjectSchema,
	type CreateProjectStage,
	CreateProjectStageSchema,
	type CreatedProject,
	createFormatToColumns,
	DEFAULT_STAGE_SETUP,
	effectiveVisibility,
	type FieldTier,
	fieldTier,
	ndaDocumentFor,
	ndaRequiredFor,
	type ProjectCreateFormat,
	type ProjectRoleSetup,
	type ProjectSetupStep,
	type ProjectVisibility,
	type ProjectWizardField,
	type ProjectWizardStep,
	setupCompleteness,
	setupSteps,
	type StageSetup,
} from "../types/projects-types.ts";
import { ProjectSidebarService } from "./ProjectSidebarService.ts";

/**
 * Wizard view-state — the cross-island bridge for `/projects/create`, and the ONE place the six-step
 * creation flow's client-side state machine lives.
 *
 * The mutations live HERE rather than in the island because an island is a dumb view (root CLAUDE.md
 * §2): it renders the draft and calls a named intent. It also settles a question the surface would
 * otherwise answer twice — the footer presses Next, the step panel holds the fields, and the review
 * step reads a ladder derived from both.
 *
 * **Nothing in this module decides anything the server also decides.** The readiness ladder is
 * {@link setupSteps}, the same function the fat service runs, and the visibility disclosure is
 * {@link effectiveVisibility} reading that ladder — so the sentence the author sees under the
 * control and the value the database receives are one decision rather than two implementations that
 * agree today. The wizard never computes a percentage, a price or a stored visibility of its own.
 *
 * **Tiers are form logic and never a palette.** {@link ProjectWizardField}'s tier drives exactly
 * three things: `T1` blocks the step, `T1`+`T2` are what the publish gate waits on, and `T3`–`T5`
 * produce hint copy. Two statuses are ever painted — `required` (RED) for a `T1` and `gate` (AMBER)
 * for a `T2` — because the theme has token backing for exactly those two ramps.
 */

// #region The working shapes
/**
 * A stage as the wizard holds it: the payload stage plus a client identity, with the dependency
 * expressed by that identity rather than by position.
 *
 * `dependsOnStageIndex` is what {@link CreateProject} carries, and an index is the wrong thing to
 * hold while a list is being dragged around — every reorder would have to rewrite every other
 * stage's dependency, and one missed remap points a stage at whichever row happens to be sitting in
 * that slot. The key survives a reorder untouched, and {@link buildCreatePayload} resolves it to the
 * index the payload wants at the one moment the order is final.
 */
export interface WizardStage extends Omit<CreateProjectStage, "dependsOnStageIndex"> {
	/** Client-side identity: stable across reorders, never sent. */
	key: string;
	/** The stage this one waits on, by {@link WizardStage.key}; `null` = project start. */
	dependsOnKey: string | null;
}

/** A staffing role as the wizard holds it — the payload role plus a client identity. */
export interface WizardRole {
	key: string;
	name: string;
	skills: string[];
}

/** The whole in-progress payload, with the two lists in their key-carrying working form. */
export interface WizardDraft extends Omit<CreateProject, "stages" | "roles"> {
	stages: WizardStage[];
	roles: WizardRole[];
}

/** What the route knows about the actor before the wizard opens. */
export interface WizardSeed {
	/** The work-flow the launcher preset, already narrowed to what the wizard offers. */
	format: ProjectCreateFormat;
	/** Whether the engagement starts out broken into stages. */
	hasStages: boolean;
	/** The acting workspace kind, so the payload's two scope fields cannot contradict each other. */
	scopeType: CreateProject["scopeType"];
	/** That workspace's id. */
	scopeId: string;
}
// #endregion

// #region Seeding
/**
 * Every default {@link CreateProjectSchema} declares, read from the schema rather than restated.
 *
 * A literal title is supplied only because `title` is the one field with no default — it is the sole
 * hard requirement of a create — and it is overwritten with `""` the moment the draft is built. The
 * point is that every OTHER default arrives from the SSOT, so a field added there appears in the
 * wizard's draft without an edit here.
 */
const SCHEMA_DEFAULTS: CreateProject = CreateProjectSchema.parse({ title: "untitled" });

let keySeq = 0;

/** Mint a client-side identity for a stage or a role. Never sent; see {@link WizardStage.key}. */
function nextKey(prefix: string): string {
	keySeq += 1;
	return `${prefix}-${keySeq}`;
}

/**
 * A stage nobody has configured beyond its name.
 *
 * Built by parsing {@link CreateProjectStageSchema}, so the fourteen defaults a new stage carries —
 * `requiresFiles: true`, `seatLimit: 3`, and the rest — come from the SSOT rather than from a list
 * here that would drift the first time one of them changed.
 */
export function blankStage(name: string): WizardStage {
	const { dependsOnStageIndex: _index, ...stage } = CreateProjectStageSchema.parse({ name });
	return { ...stage, key: nextKey("stage"), dependsOnKey: null };
}

/** A role nobody has configured beyond its name. */
export function blankRole(name: string): WizardRole {
	return { key: nextKey("role"), name, skills: [] };
}

/** The draft an author starts from. */
export function blankDraft(seed: WizardSeed): WizardDraft {
	return {
		...SCHEMA_DEFAULTS,
		title: "",
		format: seed.format,
		hasStages: seed.hasStages,
		scopeType: seed.scopeType,
		scopeId: seed.scopeId,
		stages: [],
		roles: [],
	};
}
// #endregion

// #region The store
/** The live payload being assembled. */
export const wizardDraft = signal<WizardDraft>(
	blankDraft({ format: "pipeline", hasStages: true, scopeType: "personal", scopeId: "" }),
);

/** Which of the six steps is on screen. */
export const wizardStep = signal<ProjectWizardStep>("details");

/**
 * The form has demanded every verdict be shown — set when a step refuses to advance, cleared on
 * arrival at any step.
 *
 * One signal handed to every field on the surface, which is the contract {@link useFieldValidation}
 * is written against: a field the author never reached has no verdict to show until the moment the
 * wizard refuses to move past it, and a refusal with no visible cause is worse than an early
 * warning.
 */
export const wizardReveal = signal<boolean>(false);

/** Which stage the workbench inspector is configuring, by {@link WizardStage.key}; `null` = none. */
export const wizardStageKey = signal<string | null>(null);

/** A create is in flight; the footer blocks a second press against the same draft. */
export const wizardSubmitting = signal<boolean>(false);

/** The last failure, in the words the surface shows. */
export const wizardError = signal<string | null>(null);

/**
 * The engagement the server settled on, once it exists.
 *
 * Held rather than discarded because the navigation that follows can fail (a blocked `assign`, a
 * revoked history entry), and an author whose project was created perfectly well must still be given
 * its address rather than a form that looks like it did nothing.
 */
export const wizardCreated = signal<CreatedProject | null>(null);

/** Which seed the store currently holds, so a remount cannot discard live edits. */
let seededKey: string | null = null;

/**
 * Adopt a seed, once per distinct seed.
 *
 * Called from the island's render body rather than an effect: the first paint must already show the
 * launcher's chosen work-flow, and a draft that arrived a frame later would render the wrong stage
 * vocabulary and then change it under the author's cursor.
 */
export function seedWizard(seed: WizardSeed): void {
	const key = `${seed.format}:${seed.hasStages}:${seed.scopeType}:${seed.scopeId}`;
	if (seededKey === key) return;
	seededKey = key;
	wizardDraft.value = blankDraft(seed);
	wizardStep.value = "details";
	wizardReveal.value = false;
	wizardStageKey.value = null;
	wizardSubmitting.value = false;
	wizardError.value = null;
	wizardCreated.value = null;
}
// #endregion

// #region Draft mutation
/** Fold a shallow patch over the draft. */
export function patchDraft(patch: Partial<WizardDraft>): void {
	wizardDraft.value = { ...wizardDraft.value, ...patch };
	wizardError.value = null;
}

/**
 * Switch the work-flow, normalising the terms that only mean something inside one of them.
 *
 * A pipeline has no fixed-fee milestone and a one-off has no early-delivery uplift, so leaving a
 * stale `allowDeadlineBonuses` behind would post an offer the format cannot honour — and
 * `ck_projects_deadline_bonus_format` refuses exactly that pairing at the database, which is a
 * `23514` the author cannot act on from a review screen.
 */
export function setFormat(format: ProjectCreateFormat): void {
	patchDraft({
		format,
		allowDeadlineBonuses: format === "pipeline" ? wizardDraft.value.allowDeadlineBonuses : false,
	});
}

/**
 * Turn the stage breakdown on or off.
 *
 * Neither list is discarded when it stops applying. An author who toggles stages off to look at the
 * role model and back again would otherwise lose everything they had written, and the payload
 * builder already sends only the list the shape calls for.
 */
export function setHasStages(hasStages: boolean): void {
	patchDraft({ hasStages });
	if (!hasStages) wizardStageKey.value = null;
}

/** Set the NDA terms, dropping a document reference the new mode may not carry. */
export function setNdaMode(ndaMode: CreateProject["ndaMode"]): void {
	patchDraft({
		ndaMode,
		ndaDocumentId: ndaDocumentFor(ndaMode, wizardDraft.value.ndaDocumentId),
	});
}

/** Append a stage and select it. */
export function addStage(): void {
	const draft = wizardDraft.value;
	const noun = draft.format === "pipeline" ? "Stage" : "Milestone";
	const stage = blankStage(`${noun} ${draft.stages.length + 1}`);
	patchDraft({ stages: [...draft.stages, stage] });
	wizardStageKey.value = stage.key;
}

/** Fold a patch over one stage. */
export function patchStage(key: string, patch: Partial<WizardStage>): void {
	patchDraft({
		stages: wizardDraft.value.stages.map((s) => (s.key === key ? { ...s, ...patch } : s)),
	});
}

/**
 * Remove a stage, and with it every dependency that pointed at it.
 *
 * A dangling `dependsOnKey` would resolve to `null` at build time and quietly become "starts with
 * the project" — a schedule change nobody asked for. Clearing it here makes the consequence visible
 * on the timeline step, where it can be answered.
 */
export function removeStage(key: string): void {
	const stages = wizardDraft.value.stages
		.filter((s) => s.key !== key)
		.map((s) => (s.dependsOnKey === key ? { ...s, dependsOnKey: null } : s));
	patchDraft({ stages });
	if (wizardStageKey.value === key) wizardStageKey.value = stages[0]?.key ?? null;
}

/** Move a stage from one position to another. */
export function moveStage(fromKey: string, toKey: string): void {
	const stages = wizardDraft.value.stages;
	const from = stages.findIndex((s) => s.key === fromKey);
	const to = stages.findIndex((s) => s.key === toKey);
	if (from === -1 || to === -1 || from === to) return;
	const next = stages.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	patchDraft({ stages: next });
}

/** Append a role and select nothing — roles are edited inline, not in the stage inspector. */
export function addRole(): void {
	const draft = wizardDraft.value;
	patchDraft({ roles: [...draft.roles, blankRole(`Role ${draft.roles.length + 1}`)] });
}

/** Fold a patch over one role. */
export function patchRole(key: string, patch: Partial<WizardRole>): void {
	patchDraft({ roles: wizardDraft.value.roles.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
}

/** Remove a role. */
export function removeRole(key: string): void {
	patchDraft({ roles: wizardDraft.value.roles.filter((r) => r.key !== key) });
}
// #endregion

// #region Payload
/** Whether a rich-text field carries prose a reader would actually see. */
function hasProse(value: string): boolean {
	return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").trim().length > 0;
}

/** The payload stage for one working stage, with the dependency resolved to its final position. */
function toPayloadStage(stage: WizardStage, stages: readonly WizardStage[]): CreateProjectStage {
	const { key: _key, dependsOnKey, ...rest } = stage;
	const index = dependsOnKey === null ? -1 : stages.findIndex((s) => s.key === dependsOnKey);
	return { ...rest, name: rest.name.trim(), dependsOnStageIndex: index === -1 ? null : index };
}

/**
 * The create payload for a draft.
 *
 * Only the list the engagement's shape actually uses is sent: a staged engagement sends stages and
 * no roles, a stage-less one sends roles and no stages. The alternative — sending both and letting
 * the server pick — puts a list on the wire that describes a staffing model the author turned off,
 * and the server has no way to tell an abandoned list from a deliberate one.
 *
 * `visibility` is sent as what the author ASKED for, never as what will be stored: the fat service
 * runs {@link effectiveVisibility} against the ladder and writes `unlisted` until every required
 * step is done. A client that computed its own stored visibility would be deciding its own reach.
 */
export function buildCreatePayload(draft: WizardDraft): CreateProject {
	const staged = draft.hasStages;
	return {
		...draft,
		title: draft.title.trim(),
		currency: draft.currency.toUpperCase(),
		ndaDocumentId: ndaDocumentFor(draft.ndaMode, draft.ndaDocumentId),
		allowDeadlineBonuses: draft.format === "pipeline" && draft.allowDeadlineBonuses,
		stages: staged ? draft.stages.map((s) => toPayloadStage(s, draft.stages)) : [],
		roles: staged ? [] : draft.roles.map((r) => ({ name: r.name.trim(), skills: r.skills })),
	};
}
// #endregion

// #region The readiness ladder
/** The projection of one working stage the ladder reads. */
function toStageSetup(stage: WizardStage, order: number, stages: readonly WizardStage[]): StageSetup {
	const { key, dependsOnKey, ...rest } = stage;
	const index = dependsOnKey === null ? -1 : stages.findIndex((s) => s.key === dependsOnKey);
	return { ...rest, id: key, order, dependsOnStageIndex: index === -1 ? null : index };
}

/** The projection of one working role the ladder reads. Create carries no per-role budget. */
function toRoleSetup(role: WizardRole): ProjectRoleSetup {
	return { id: role.key, name: role.name, skills: role.skills, budgetCents: null };
}

/**
 * The single delivery stage the server mints for an engagement that declares none.
 *
 * Modelled here so the review step describes the project that will EXIST rather than the payload
 * that is about to be posted — `projects.create_project` mints exactly this stage after its stage
 * loop, carrying the project's own scope and, when the budget is a fixed price, its amount as the
 * stage's `unit_price_cents`. Reporting "add at least one stage" beside a wizard whose stage list is
 * switched off would be a requirement with no control anywhere that answers it.
 *
 * An hourly cap is deliberately NOT carried across: it is a ceiling on spend, and
 * `finance.fn_hold_ticket_escrow` reads `unit_price_cents` as an amount to hold.
 */
function implicitStage(draft: WizardDraft): StageSetup {
	const fixed = draft.budget !== null && draft.budget.budgetType === "fixed_price";
	return {
		...DEFAULT_STAGE_SETUP,
		id: "implicit-delivery",
		name: "Delivery",
		order: 0,
		description: draft.scope,
		unitPriceCents: fixed ? draft.budget?.amountCents ?? null : null,
	};
}

/** The readiness ladder for the draft — the same rows the fat service derives after the write. */
export function ladderFor(draft: WizardDraft): ProjectSetupStep[] {
	const columns = createFormatToColumns(draft.format, draft.hasStages);
	const stages = draft.hasStages && draft.stages.length > 0
		? draft.stages.map((stage, order) => toStageSetup(stage, order, draft.stages))
		: [implicitStage(draft)];
	return setupSteps({
		title: draft.title,
		format: columns.format,
		structure: columns.structure,
		description: draft.scope,
		budget: {
			budgetType: draft.budget?.budgetType ?? "fixed_price",
			amountCents: draft.budget?.amountCents ?? null,
			currency: draft.currency,
		},
		stages,
		roles: draft.roles.map(toRoleSetup),
		rules: {
			visibility: draft.visibility,
			ipOwnershipMode: draft.ipOwnershipMode,
			ndaRequired: ndaRequiredFor(draft.ndaMode),
			ndaMode: draft.ndaMode,
			ndaDocumentId: draft.ndaDocumentId,
			portfolioDisplayRights: draft.portfolioDisplayRights,
			timelinePreset: "sequential",
			allowDeadlineBonuses: draft.allowDeadlineBonuses,
			locationRestriction: draft.locations,
			languageRequirement: draft.languages,
		},
		status: "draft",
	});
}

/** The ladder, live. */
export const wizardLadder: ReadonlySignal<ProjectSetupStep[]> = computed(() =>
	ladderFor(wizardDraft.value)
);

/** How much of the ladder is done, 0..100 — the server's own arithmetic, not a second one. */
export const wizardCompleteness: ReadonlySignal<number> = computed(() =>
	setupCompleteness(wizardLadder.value)
);

/**
 * The visibility this engagement would actually be stored under right now.
 *
 * The disclosure the review step renders. It is {@link effectiveVisibility}, which the fat service
 * also calls, so the sentence and the write are one decision. A freshly created project has
 * satisfied nothing, so this reads `unlisted` until the required rows are done — which is the honest
 * answer, not a caveat.
 */
export const wizardEffectiveVisibility: ReadonlySignal<ProjectVisibility> = computed(() =>
	effectiveVisibility(wizardDraft.value.visibility, wizardLadder.value)
);

/** The ladder row measuring one requirement, or `undefined`. */
export function ladderRow(
	steps: readonly ProjectSetupStep[],
	key: ProjectSetupStep["key"],
): ProjectSetupStep | undefined {
	return steps.find((step) => step.key === key);
}
// #endregion

// #region Problems
/** One outstanding answer, with the control it belongs to and how badly the wizard wants it. */
export interface WizardProblem {
	field: ProjectWizardField;
	/** The stage it belongs to, by {@link WizardStage.key}, for a per-stage control. */
	stageKey: string | null;
	tier: FieldTier;
	message: string;
}

/** Whether a tier blocks the step it lives on. */
function blocksStep(tier: FieldTier): boolean {
	return tier === "T1";
}

/** The problem list for one step, in the order the step renders its controls. */
export function stepProblems(draft: WizardDraft, step: ProjectWizardStep): WizardProblem[] {
	const problems: WizardProblem[] = [];
	const tierOf = (field: ProjectWizardField) => fieldTier(field, draft.format);
	const push = (field: ProjectWizardField, stageKey: string | null, message: string) => {
		problems.push({ field, stageKey, tier: tierOf(field), message });
	};
	const ladder = ladderFor(draft);
	const staged = draft.hasStages;

	if (step === "details") {
		if (draft.title.trim().length === 0) push("title", null, "Name the project to continue.");
		const description = ladderRow(ladder, "description");
		if (description && !description.done) push("scope", null, description.hint);
	}

	if (step === "stages" && staged) {
		for (const stage of draft.stages) {
			if (stage.name.trim().length === 0) {
				push("stageName", stage.key, "Every stage needs a name.");
			}
			if (!hasProse(stage.description)) {
				push("stageDescription", stage.key, "Scope this stage before posting the project.");
			}
		}
	}

	if (step === "timeline" && staged) {
		draft.stages.forEach((stage, index) => {
			if (stage.dependsOnKey === null) return;
			const target = draft.stages.findIndex((s) => s.key === stage.dependsOnKey);
			if (target >= index) {
				push(
					"stageDependsOn",
					stage.key,
					target === index
						? "A stage cannot wait on itself."
						: "A stage can only wait on one that runs before it.",
				);
			}
			if (stage.durationMode === "fixed_deadline" && !stage.dueDate) {
				push("stageDuration", stage.key, "Pick the date this stage is due.");
			}
			if (stage.durationMode === "relative_duration" && stage.durationDays === null) {
				push("stageDuration", stage.key, "Say how many days this stage runs for.");
			}
		});
	}

	if (step === "budget") {
		if (staged) {
			for (const stage of draft.stages) {
				if (stage.unitPriceCents === null) {
					push(
						"stageUnitPrice",
						stage.key,
						draft.format === "pipeline"
							? "Set a ticket price before posting this stage."
							: "A fixed-fee milestone needs its fee.",
					);
				}
			}
		} else {
			const pricing = ladderRow(ladder, "pricing");
			if (pricing && !pricing.done) push("stageUnitPrice", null, pricing.hint);
			const roles = ladderRow(ladder, "roles");
			if (roles && !roles.done) push("roles", null, roles.hint);
		}
	}

	return problems;
}

/** The live problem list for the step on screen. */
export const wizardProblems: ReadonlySignal<WizardProblem[]> = computed(() =>
	stepProblems(wizardDraft.value, wizardStep.value)
);

/** The problems on the current step that stop it advancing. */
export const wizardBlockers: ReadonlySignal<WizardProblem[]> = computed(() =>
	wizardProblems.value.filter((p) => blocksStep(p.tier))
);

/** The message for one control on the current step, or `null` when it has nothing outstanding. */
export function problemFor(
	problems: readonly WizardProblem[],
	field: ProjectWizardField,
	stageKey: string | null,
): string | null {
	const match = problems.find((p) => p.field === field && p.stageKey === stageKey);
	return match ? match.message : null;
}

/**
 * Everything still standing between this draft and a listed project, across every step.
 *
 * The review step's own list. It is the ladder's outstanding required rows plus the `T1`/`T2` field
 * answers no ladder row measures — a stage with no scope satisfies "add at least one stage" and is
 * still not something a freelancer can judge.
 */
export function outstandingForPosting(draft: WizardDraft): WizardProblem[] {
	const steps: ProjectWizardStep[] = ["details", "legal", "stages", "timeline", "budget"];
	return steps
		.flatMap((step) => stepProblems(draft, step))
		.filter((problem) => blocksPosting(problem.tier));
}
// #endregion

// #region Navigation
/** The six steps, in order. */
export const WIZARD_STEPS: readonly ProjectWizardStep[] = [
	"details",
	"legal",
	"stages",
	"timeline",
	"budget",
	"review",
];

/** Where a step sits in the flow. */
export function stepIndex(step: ProjectWizardStep): number {
	return WIZARD_STEPS.indexOf(step);
}

/**
 * Whether the author may open a step from where they are.
 *
 * Backwards is always allowed — a step already passed cannot be made unreachable by an answer given
 * later, and stranding someone on step 4 because they cleared the title is a trap rather than a
 * gate. Forwards requires every step in between to be clear of its `T1` blockers.
 */
export function canEnter(draft: WizardDraft, from: ProjectWizardStep, to: ProjectWizardStep): boolean {
	const target = stepIndex(to);
	if (target <= stepIndex(from)) return true;
	return WIZARD_STEPS.slice(0, target).every((step) =>
		stepProblems(draft, step).every((problem) => !blocksStep(problem.tier))
	);
}

/**
 * Open a step, or refuse and show why.
 *
 * A refusal reveals every verdict on the step being left rather than disabling the control that was
 * pressed: a disabled Next with no explanation states that something is wrong without saying what,
 * and the author has to go hunting for it.
 */
export function goToStep(step: ProjectWizardStep): boolean {
	const draft = wizardDraft.value;
	if (!canEnter(draft, wizardStep.value, step)) {
		wizardReveal.value = true;
		return false;
	}
	wizardStep.value = step;
	wizardReveal.value = false;
	wizardError.value = null;
	return true;
}

/** Advance one step. */
export function goNext(): boolean {
	const next = WIZARD_STEPS[stepIndex(wizardStep.value) + 1];
	return next ? goToStep(next) : false;
}

/** Go back one step. */
export function goBack(): boolean {
	const previous = WIZARD_STEPS[stepIndex(wizardStep.value) - 1];
	return previous ? goToStep(previous) : false;
}
// #endregion

// #region Submit
/** Whether the draft carries the one thing a create genuinely requires. */
export const wizardCanCreate: ReadonlySignal<boolean> = computed(() =>
	wizardDraft.value.title.trim().length > 0 && !wizardSubmitting.value
);

/**
 * Create the engagement and open it.
 *
 * The address is the SERVER's slug, never one derived here: the database may have appended a
 * disambiguator because two people named a project the same thing, or fallen back to a generated
 * address because the title slugified to nothing. Navigating to a locally guessed slug is what used
 * to land the author on "Project not found" over a project that had been created perfectly well.
 *
 * `wizardSubmitting` stays true through a successful navigation, because the document is already
 * unloading and re-enabling the button would only offer a second create of the same draft.
 */
export async function submitWizard(): Promise<void> {
	if (wizardSubmitting.value) return;
	const draft = wizardDraft.value;
	if (draft.title.trim().length === 0) {
		wizardStep.value = "details";
		wizardReveal.value = true;
		wizardError.value = "Name the project before creating it.";
		return;
	}

	wizardSubmitting.value = true;
	wizardError.value = null;
	const result = await ProjectSidebarService.create(buildCreatePayload(draft));

	if (result.ok && result.data) {
		wizardCreated.value = result.data;
		try {
			globalThis.location.assign(`/projects/${result.data.slug}`);
			return;
		} catch {
			// The row exists; only the navigation failed. The surface offers the address instead.
			wizardSubmitting.value = false;
			return;
		}
	}

	wizardSubmitting.value = false;
	wizardError.value = result.message ?? "The project could not be created. Try again.";
}
// #endregion
