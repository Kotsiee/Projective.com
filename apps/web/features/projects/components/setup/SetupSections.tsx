import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	Checkbox,
	Chips,
	DatePicker,
	type DateValue,
	type FieldValidation,
	InputNumber,
	InputText,
	MultiSelect,
	type Option,
	Select,
	SelectButton,
	ToggleSwitch,
	useFieldValidation,
} from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { DndContext, useSortable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import { CATEGORY_META, FileCategory } from "@projective/types/files";
import { TaskListEditor } from "../ticket/TaskListEditor.tsx";
import {
	DEADLINE_BONUS_RATE,
	DEFAULT_STAGE_SETUP,
	ndaDocumentFor,
	ndaRequiredFor,
	ROLE_SECTION_LABEL,
	STAGE_ITEM_LABEL,
	STAGE_SECTION_LABEL,
} from "../../types/projects-types.ts";
import type {
	IpOwnershipMode,
	NdaMode,
	PortfolioDisplayRights,
	ProjectRoleSetup,
	ProjectSetup,
	ProjectSetupPatch,
	ProjectSetupStepKey,
	ProjectStructure,
	ProjectVisibility,
	StageDurationMode,
	StageSetup,
	TicketTask,
	TimelinePreset,
} from "../../types/projects-types.ts";
import { patchSetup, setupReveal } from "../../core/setup-state.ts";

/**
 * SetupSections — the owner Details form's section set, and the pure rule that decides which of them
 * an engagement actually gets.
 *
 * The four format branches are one component set with a dispatcher rather than four screens, because
 * the difference between a Pipeline and a Direct Deliverable is WHICH sections apply, not how a
 * section behaves: a stage list relabelled "Milestones" is the same editor, and forking it would give
 * a milestone its own chance to drift away from a stage.
 *
 * **Every field of {@link ProjectSetup} is bound to a control here.** A term chosen once at creation
 * and then invisible is a term nobody can ever fix, so the six wizard steps land here as controls
 * rather than as a second surface: the engagement terms in Rules, the engagement's shape in Basics,
 * and the whole of a stage's configuration — steps, skills, seats, sequencing, timing, submission
 * rules and its confidentiality override — inside the stage's own disclosure.
 *
 * The one thing the wizard collects that this form does not is the brief's reference ATTACHMENTS.
 * That is not an omission here: `ProjectSetup` carries no attachment field, so the projection this
 * form edits has nothing to bind, and uploading against a library needs an owner id the projection
 * also does not carry. Adding the control without both would be an affordance whose handler reaches
 * nothing.
 *
 * Every control is a `@projective/ui/fields` primitive and every edit routes through
 * {@link patchSetup}, so the ladder in the header band re-derives from the same
 * {@link reconcileSetup} the server runs. Nothing here computes a percentage, a total or a gate.
 *
 * Validation follows the §A.7.5 policy: a field is given a coloured status only after the reader has
 * finished with it, or once a refused save has demanded every verdict at once, and that status stands
 * down again while the field holds focus. Nothing paints at rest — the outstanding work is reported
 * as prose by the section hint and the stage row's own summary, where it can be read without a colour.
 *
 * Static content is never boxed and non-actionable metadata is never a chip (DESIGN_SYSTEM §B.4,
 * §B.11): a section is separated by spacing and at most one hairline, and a stage's outstanding
 * requirements read as inline middot-separated text rather than as pills that look pressable and
 * are not.
 */

// #region Section vocabulary
/** Which section a format gets, in render order. */
export type SetupSectionKey =
	| "basics"
	| "description"
	| "budget"
	| "stages"
	| "roles"
	| "rules";

/**
 * The sections this engagement's shape calls for.
 *
 * A Direct Deliverable (`structure === "single_task"`) takes roles instead of stages — it has no
 * stage run at all — which is the same discrimination the setup ladder makes when it emits a `roles`
 * row rather than a `stages` one. Keeping both rules keyed on the same field is what stops the form
 * from rendering a list the progress bar is not counting.
 */
export function sectionsFor(setup: ProjectSetup): SetupSectionKey[] {
	const staffing: SetupSectionKey = setup.structure === "single_task" ? "roles" : "stages";
	return ["basics", "description", "budget", staffing, "rules"];
}

/** The heading a format gives its budget section. */
export function budgetSectionLabel(setup: ProjectSetup): string {
	if (setup.format === "session") return "Session pricing";
	if (setup.format === "pipeline") return "Budget & pricing";
	return "Budget";
}

/** The heading a format gives its staffing section. */
export function staffingSectionLabel(setup: ProjectSetup): string {
	return setup.structure === "single_task" ? ROLE_SECTION_LABEL : STAGE_SECTION_LABEL[setup.format];
}

/**
 * Whether a ladder row is still outstanding.
 *
 * Read off the SERVER's own ladder rather than re-derived from the data beside it. A field that
 * decided for itself whether pricing was satisfied would be a second implementation of the rule the
 * progress bar is drawing, and the two would eventually disagree in front of the same owner.
 */
export function outstanding(setup: ProjectSetup, key: ProjectSetupStepKey): boolean {
	const step = setup.steps.find((s) => s.key === key);
	return step !== undefined && !step.done;
}
// #endregion

// #region Label maps
/**
 * The human words for each enum member.
 *
 * Written as exhaustive `Record`s keyed on the SSOT enum types rather than as free option arrays, so
 * a member added to the schema fails to compile here instead of quietly rendering a dropdown that is
 * missing one of its own values.
 */
const VISIBILITY_LABEL: Record<ProjectVisibility, string> = {
	public: "Public — listed on Explore",
	invite_only: "Invite only — reachable by invitation",
	unlisted: "Unlisted — reachable by link",
};

const IP_LABEL: Record<IpOwnershipMode, string> = {
	exclusive_transfer: "Exclusive transfer to the client",
	licensed_use: "Licensed use",
	shared_ownership: "Shared ownership",
	projective_partner: "Projective partner terms",
};

const PORTFOLIO_LABEL: Record<PortfolioDisplayRights, string> = {
	allowed: "May be shown publicly",
	forbidden: "May not be shown",
	embargoed: "May be shown after an embargo",
};

const TIMELINE_LABEL: Record<TimelinePreset, string> = {
	sequential: "Sequential — one after another",
	simultaneous: "Simultaneous — all at once",
	staggered: "Staggered — overlapping starts",
	custom: "Custom",
};

const NDA_LABEL: Record<NdaMode, string> = {
	none: "No NDA",
	platform_standard: "Projective's standard NDA",
	custom: "A confidentiality agreement I supply",
};

const DURATION_LABEL: Record<StageDurationMode, string> = {
	no_due_date: "No due date",
	relative_duration: "A number of days after it opens",
	fixed_deadline: "A fixed calendar date",
};

/** Turn an exhaustive label map into the `Option[]` a `Select` takes, in declaration order. */
function optionsOf<K extends string>(labels: Record<K, string>): Option[] {
	return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}

const FORMAT_OPTIONS: Option[] = [
	{ value: "pipeline", label: "Pipeline" },
	{ value: "one_off", label: "One-off" },
	{ value: "session", label: "Sessions" },
];

const FORMAT_HINT: Record<ProjectSetup["format"], string> = {
	pipeline: "A multi-stage workflow. Freelancers claim tickets stage by stage.",
	one_off: "A fixed engagement delivered against milestones.",
	session: "Booked time rather than tickets — one-to-one or a cohort.",
};

/**
 * The two shapes each format takes — the edit side of the wizard's `hasStages` toggle.
 *
 * The wizard asks one question ("break this into stages?") and `createFormatToColumns` folds the
 * answer into `structure_variation`, which is the only thing stored: `hasStages` is DERIVED, so the
 * form has to offer the same choice through the column rather than through a boolean of its own. Both
 * formats get it, because a shape chosen once at creation and editable on only one of the two is a
 * shape half the owners can never correct.
 *
 * A session has no such choice — a sitting is not divisible into stages — so it has no entry, and the
 * control is absent rather than offered with one option.
 */
const SHAPE_OPTIONS: Partial<Record<ProjectSetup["format"], Option[]>> = {
	pipeline: [
		{ value: "standard", label: "Staged" },
		{ value: "single_stage", label: "Single stage" },
	],
	one_off: [
		{ value: "one_off", label: "Milestones" },
		{ value: "single_task", label: "Direct deliverable" },
	],
};

const SHAPE_HINT: Partial<Record<ProjectSetup["format"], string>> = {
	pipeline: "A single stage runs the whole engagement as one continuous body of work.",
	one_off: "A direct deliverable is staffed by roles rather than run through milestones.",
};

/** The structure a format falls back to when the stored one is not one of its own two shapes. */
const DEFAULT_STRUCTURE: Record<ProjectSetup["format"], ProjectStructure> = {
	pipeline: "standard",
	one_off: "one_off",
	session: "single_stage",
};

/**
 * The shape a format is actually in, given what is stored.
 *
 * `structure` and `format` are two columns that can legitimately disagree for a moment — a pipeline
 * whose owner switches it to a one-off is carrying `standard`, which is not one of a one-off's
 * shapes — so the control resolves rather than trusts. Falling back keeps the segmented control from
 * rendering with nothing selected, which reads as "no answer" for a field that always has one.
 */
function shapeOf(format: ProjectSetup["format"], structure: ProjectStructure): ProjectStructure {
	const options = SHAPE_OPTIONS[format];
	const known = options?.some((option) => option.value === structure) ?? false;
	return known ? structure : DEFAULT_STRUCTURE[format];
}

/** The uplift the deadline-bonus offer is stated as, from the one constant that carries the rate. */
const DEADLINE_BONUS_PERCENT = Math.round(DEADLINE_BONUS_RATE * 100);

const SESSION_KIND_OPTIONS: Option[] = [
	{ value: "normal", label: "One-to-one" },
	{ value: "group", label: "Group" },
];

const BUDGET_TYPE_OPTIONS: Option[] = [
	{ value: "fixed_price", label: "Fixed price" },
	{ value: "hourly_cap", label: "Hourly cap" },
];

const CURRENCY_OPTIONS: Option[] = ["USD", "GBP", "EUR", "AUD", "CAD"].map((c) => ({
	value: c,
	label: c,
}));

/** Seats are headcount, and "everyone who wants one" is an answer rather than a missing number. */
const SEAT_MODE_OPTIONS: Option[] = [
	{ value: "limited", label: "Limited" },
	{ value: "unlimited", label: "Unlimited" },
];

/**
 * Every submission category a stage may be restricted to, labelled from the files taxonomy.
 *
 * Derived from `FileCategory` itself rather than listed, because the column is a
 * `files.file_category[]` and a hand-kept list would eventually offer a member Postgres refuses (or
 * omit one it accepts) with nothing but a `22P02` to say which.
 */
const FILE_CATEGORY_OPTIONS: Option[] = FileCategory.options.map((value) => ({
	value,
	label: CATEGORY_META[value].label,
}));

/** The sentinel a dependency `Select` uses for "runs on its own"; `""` is not a distinguishable value. */
const NO_DEPENDENCY = "none";
// #endregion

// #region Value conversion
/**
 * Minor units to the major units a person types, and back.
 *
 * The schema stores minor units because a currency amount held as a float is a currency amount that
 * eventually loses a penny; the field shows major units because that is what the owner is quoting.
 * The rounding happens once, on the way in.
 */
function toMajor(minor: number | null): number | null {
	return minor === null ? null : minor / 100;
}

function toMinor(major: number | null): number | null {
	if (major === null || !Number.isFinite(major)) return null;
	return Math.max(0, Math.round(major * 100));
}

/**
 * An ISO instant to the `Date` the picker binds, and back.
 *
 * Both directions refuse an unparseable value rather than throwing: `new Date("")` is an Invalid
 * Date, and `toISOString()` on one raises — which would take the whole form down over a stored
 * string nobody can see.
 */
function toDate(iso: string | null): Date | null {
	if (!iso) return null;
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoInstant(value: DateValue): string | null {
	const date = Array.isArray(value) ? value[0] ?? null : value;
	if (!date || Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

/**
 * A stage's step labels as the ticket task list's own row shape, and back.
 *
 * The two lists are the same list at two moments: a stage's steps are the template a ticket raised
 * against it is seeded from, so they are edited with the SAME component rather than a second one that
 * would slowly grow different affordances. The projection is deliberately lossy in one direction only
 * — a template step has nobody to have completed it and no submission behind it, so `done` and
 * `completedBy` are constants here and the component is asked to hide that channel entirely.
 *
 * Identity is positional because a stage step has none of its own: the schema stores labels, so an id
 * exists only to key a row and drive one drag, and it is discarded the moment the edit is folded back.
 */
function asTaskRows(labels: readonly string[]): TicketTask[] {
	return labels.map((text, index) => ({
		id: `step-${index}`,
		text,
		done: false,
		completedBy: [],
	}));
}

function asStepLabels(rows: readonly TicketTask[]): string[] {
	return rows.map((row) => row.text);
}
// #endregion

// #region Layout primitives
/** One labelled section of the form. Separated by spacing and a single hairline, never a box. */
export function Section(props: {
	title: string;
	/** The ladder hint for this section, shown only while the requirement is outstanding. */
	hint?: string;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<section class="psu-section">
			<div class="psu-section__head">
				<h2 class="psu-section__title">{props.title}</h2>
				{props.hint && <p class="psu-section__hint">{props.hint}</p>}
			</div>
			<div class="psu-section__body">{props.children}</div>
		</section>
	);
}

/**
 * A control plus its verdict, with the field's focus lifecycle tracked at the wrapper.
 *
 * Focus is watched here rather than on the control because `focusin`/`focusout` BUBBLE where `focus`
 * and `blur` do not: one wrapper therefore gives a Select, a number input and a rich-text region the
 * same clear-on-focus behaviour, and none of them has to grow a focus prop it does not have. It also
 * means a control whose panel is body-portalled reads as "left" the moment focus moves into that
 * panel, which is the honest answer — the reader has finished with the field's own box.
 *
 * The message carries a stable id derived from the control's, so a caller that owns a real input can
 * point `aria-describedby` at it. A reference to an element that is not currently rendered is simply
 * skipped by assistive technology, which is why the id may be wired unconditionally.
 */
export function Validated(props: {
	validation: FieldValidation;
	/** Id for the message element — `${controlId}-problem` by convention. */
	messageId?: string;
	children: ComponentChildren;
}): JSX.Element {
	const message = props.validation.message.value;
	return (
		<div
			class="psu-validated"
			onFocusIn={props.validation.handlers.onFocus}
			onFocusOut={props.validation.handlers.onBlur}
		>
			{props.children}
			{message && (
				<p
					class="psu-field__problem"
					id={props.messageId}
					data-status={props.validation.hintStatus.value}
				>
					{message}
				</p>
			)}
		</div>
	);
}

/**
 * One labelled control.
 *
 * `htmlFor` is supplied only for controls that expose a real focusable element with that id — the
 * text and number inputs. The composite controls (Select, SelectButton, Chips) take an `aria-label`
 * instead, so their visible name renders as a `<span>`: a `<label for>` pointing at an id no element
 * carries is worse than no label element at all, because assistive technology follows it and finds
 * nothing.
 */
export function Field(props: {
	label: string;
	htmlFor?: string;
	hint?: string;
	/** The control's validation lifecycle; supplying it wraps the control in a {@link Validated}. */
	validation?: FieldValidation;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<div class="psu-field">
			{props.htmlFor
				? <label class="psu-field__label" for={props.htmlFor}>{props.label}</label>
				: <span class="psu-field__label">{props.label}</span>}
			{props.validation
				? (
					<Validated
						validation={props.validation}
						messageId={props.htmlFor ? `${props.htmlFor}-problem` : undefined}
					>
						{props.children}
					</Validated>
				)
				: props.children}
			{props.hint && <p class="psu-field__hint">{props.hint}</p>}
		</div>
	);
}

/**
 * A conditional group of settings, closed by default.
 *
 * A native `<details>` rather than a scripted disclosure: it works with no JavaScript, it is
 * announced correctly without any ARIA of its own, and it carries no box — the stage row it sits in
 * already spends the one contour §B.4 allows, so a second bordered panel inside it would be exactly
 * the card-in-card the design system forbids.
 */
function Advanced(props: { summary: string; children: ComponentChildren }): JSX.Element {
	return (
		<details class="psu-adv">
			<summary class="psu-adv__summary">
				<span class="psu-adv__mark" aria-hidden="true">
					<Icon name="chevron-down" />
				</span>
				{props.summary}
			</summary>
			<div class="psu-adv__body">{props.children}</div>
		</details>
	);
}

/** A small heading inside a stage's disclosure. Type, not a container — nothing here is boxed. */
function SubHead(props: { children: ComponentChildren }): JSX.Element {
	return <p class="psu-subhead">{props.children}</p>;
}
// #endregion

// #region Basics
/**
 * Identity and shape.
 *
 * Changing the format resolves `structure` and `sessionKind` in the same patch, because both are only
 * meaningful inside one format each: a pipeline has no session kind, and leaving a stale `group`
 * behind would let the ladder and the section set disagree about what is being sold. The shape is
 * CARRIED where the target format can express it and replaced only where it cannot ({@link shapeOf}),
 * so looking at another format and coming back does not silently rewrite a decision the owner made.
 *
 * A format change also withdraws the deadline-bonus offer, which `ck_projects_deadline_bonus_format`
 * permits on a pipeline alone. Clearing it in the SAME patch is what stops a project that once ran as
 * a pipeline from carrying a term its own shape no longer allows into a save that Postgres would
 * refuse with a constraint name the owner cannot act on.
 */
export function BasicsSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const title = useFieldValidation({
		problem: setup.title.trim() ? null : "Give the project a name.",
		reveal: setupReveal,
		problemStatus: "required",
	});

	const setFormat = (next: string | string[]) => {
		const format = next as ProjectSetup["format"];
		const patch: ProjectSetupPatch = {
			format,
			// Carried through {@link shapeOf} rather than reset, so an owner who looks at another format
			// and comes back still has the shape they chose. Only a shape the target format cannot
			// express is replaced.
			structure: shapeOf(format, setup.structure),
			sessionKind: format === "session"
				? (setup.sessionKind === "group" ? "group" : "normal")
				: "none",
		};
		if (format !== "pipeline") patch.rules = { allowDeadlineBonuses: false };
		patchSetup(patch);
	};

	const shapeOptions = SHAPE_OPTIONS[setup.format];

	return (
		<Section title="Basics" hint={hint}>
			<Field label="Project name" htmlFor="psu-title" validation={title}>
				<InputText
					id="psu-title"
					aria-describedby="psu-title-problem"
					value={setup.title}
					onValueChange={(next: string) => patchSetup({ title: next })}
					placeholder="Name the engagement"
					block
					maxLength={160}
					status={title.status.value}
				/>
			</Field>

			<Field label="Project type" hint={FORMAT_HINT[setup.format]}>
				<SelectButton
					options={FORMAT_OPTIONS}
					value={setup.format}
					onValueChange={setFormat}
					aria-label="Project type"
				/>
			</Field>

			{shapeOptions && (
				<Field label="Shape" hint={SHAPE_HINT[setup.format]}>
					<SelectButton
						options={shapeOptions}
						value={shapeOf(setup.format, setup.structure)}
						onValueChange={(v: string | string[]) =>
							patchSetup({ structure: v as ProjectStructure })}
						aria-label="Shape"
					/>
				</Field>
			)}

			{setup.format === "session" && (
				<Field label="Session kind" hint="A group session seats a cohort in the same booking.">
					<SelectButton
						options={SESSION_KIND_OPTIONS}
						value={setup.sessionKind === "group" ? "group" : "normal"}
						onValueChange={(v: string | string[]) =>
							patchSetup({ sessionKind: v as ProjectSetup["sessionKind"] })}
						aria-label="Session kind"
					/>
				</Field>
			)}
		</Section>
	);
}
// #endregion

// #region Description
/** The engagement's scope, as prose a freelancer judges their fit against. */
export function DescriptionSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const scope = useFieldValidation({
		problem: outstanding(setup, "description")
			? "Describe the work so a freelancer can judge whether they fit it."
			: null,
		reveal: setupReveal,
		problemStatus: "gate",
	});

	return (
		<Section title="Description" hint={hint}>
			<Validated validation={scope}>
				<RichTextEditor
					key={setup.slug}
					value={setup.description}
					onValueChange={(description: string) => patchSetup({ description })}
					placeholder="Describe the work, its goals and its context…"
					status={scope.status.value}
					minRows={5}
					aria-label="Project description"
				/>
			</Validated>
		</Section>
	);
}
// #endregion

// #region Budget
/**
 * What the engagement pays, at the project level.
 *
 * On a session engagement this is the rate a single sitting is charged at; the count and the duration
 * of those sittings live on the session rows themselves, so the two facts are stated where they are
 * edited rather than restated here where they could disagree.
 *
 * The amount is only a problem while NOTHING anywhere is priced. A project that prices every stage
 * individually has satisfied the pricing rung, and painting its empty project-level field amber would
 * be reporting a requirement the ladder beside it says is met.
 */
export function BudgetSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const session = setup.format === "session";
	const amountLabel = session ? "Rate per session" : "Amount";
	const item = STAGE_ITEM_LABEL[setup.format];
	const amount = useFieldValidation({
		problem: outstanding(setup, "pricing")
			? `Set an amount here, or price at least one ${item}.`
			: null,
		reveal: setupReveal,
		problemStatus: "gate",
	});

	return (
		<Section title={budgetSectionLabel(setup)} hint={hint}>
			<div class="psu-row">
				<Field label="Budget type">
					<Select
						options={BUDGET_TYPE_OPTIONS}
						value={setup.budget.budgetType}
						onValueChange={(v: string) =>
							patchSetup({ budget: { budgetType: v as ProjectSetup["budget"]["budgetType"] } })}
						aria-label="Budget type"
					/>
				</Field>

				<Field label={amountLabel} htmlFor="psu-budget-amount" validation={amount}>
					<InputNumber
						id="psu-budget-amount"
						aria-describedby="psu-budget-amount-problem"
						value={toMajor(setup.budget.amountCents)}
						onValueChange={(v: number | null) =>
							patchSetup({ budget: { amountCents: toMinor(v) } })}
						mode="currency"
						currency={setup.budget.currency}
						min={0}
						placeholder="Not set"
						status={amount.status.value}
					/>
				</Field>

				<Field
					label="Currency"
					hint="Every price on this engagement is quoted in it."
				>
					<Select
						options={CURRENCY_OPTIONS}
						value={setup.budget.currency}
						onValueChange={(currency: string) => patchSetup({ budget: { currency } })}
						aria-label="Currency"
					/>
				</Field>
			</div>

			{session && (
				<p class="psu-note">
					{setup.stages.length === 0
						? "No sessions scheduled yet."
						: `${setup.stages.length} session${setup.stages.length === 1 ? "" : "s"} scheduled`}
					{" · each session carries its own duration below"}
				</p>
			)}
		</Section>
	);
}
// #endregion

// #region Stage list
let draftSeq = 0;

/** Mint a client-side id the fat service reads as a CREATE (the `stage-draft-` prefix is the signal). */
function newStageId(): string {
	draftSeq += 1;
	return `stage-draft-${draftSeq}`;
}

/** Mint a client-side id the fat service reads as a role CREATE. */
function newRoleId(): string {
	draftSeq += 1;
	return `role-draft-${draftSeq}`;
}

function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
	const next = arr.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

/**
 * Re-index a reordered or shortened stage list, carrying every dependency to the row it named.
 *
 * `dependsOnStageIndex` is a POSITION, so any edit that moves a row silently repoints every
 * dependency that crossed it: drag stage 3 above stage 2 without this and stage 2 starts waiting on
 * whatever now sits where its dependency used to. The remap resolves each index back to the stage it
 * meant through the PREVIOUS ordering and then looks that stage up in the new one, so the named
 * relationship survives the move.
 *
 * Two dependencies do not survive, and both are cleared rather than clamped: one on a stage that has
 * been removed, which now names nothing, and one that has ended up AFTER the stage that waits on it,
 * which a sequence cannot express. Clamping either to a neighbour would invent a relationship the
 * owner never described.
 */
function remapDependencies(
	previous: readonly StageSetup[],
	next: readonly StageSetup[],
): StageSetup[] {
	const idAtOldIndex = previous.map((stage) => stage.id);
	const newIndexById = new Map(next.map((stage, index) => [stage.id, index]));
	return next.map((stage, index) => {
		const dependency = stage.dependsOnStageIndex;
		if (dependency === null) return { ...stage, order: index };
		const named = idAtOldIndex[dependency];
		const moved = named === undefined ? undefined : newIndexById.get(named);
		const resolved = moved !== undefined && moved < index ? moved : null;
		return { ...stage, order: index, dependsOnStageIndex: resolved };
	});
}

/** The stages that may legitimately precede a given row, as dependency options. */
function dependencyOptions(stages: readonly StageSetup[], index: number, item: string): Option[] {
	const options: Option[] = [{ value: NO_DEPENDENCY, label: `Starts with the project` }];
	for (let i = 0; i < index; i += 1) {
		options.push({ value: String(i), label: stages[i].name || `Untitled ${item} ${i + 1}` });
	}
	return options;
}

interface StageRowProps {
	stage: StageSetup;
	index: number;
	/** The whole list, so the dependency picker can name the rows that precede this one. */
	stages: readonly StageSetup[];
	itemLabel: string;
	format: ProjectSetup["format"];
	currency: string;
	open: boolean;
	onToggle: () => void;
	onPatch: (patch: Partial<StageSetup>) => void;
	onRemove: () => void;
}

/**
 * One stage row: a drag handle, a disclosure, and the stage's whole configuration.
 *
 * The outstanding requirements read as inline middot-separated text rather than as chips. A chip is a
 * promise of interactivity (§B.11) and "Needs pricing" cannot be pressed; the way to act on it is the
 * field two lines below, which the disclosure already opens.
 *
 * A session's stage is a sitting rather than a step in a workflow, so the two groups that describe a
 * workflow — seats and sequencing — are not rendered for one. Their stored values are left untouched
 * rather than normalised away: a format is switchable, and blanking a pipeline's staffing because it
 * was briefly a session would destroy configuration the owner never asked to lose.
 */
function StageRow(props: StageRowProps): JSX.Element {
	const { stage, format, itemLabel } = props;
	const session = format === "session";
	const sortable = useSortable({
		id: `stage:${stage.id}`,
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: itemLabel,
	});
	const scoped = stage.description.trim().length > 0;
	const priced = stage.unitPriceCents !== null;
	const outstandingNotes = [!scoped && "Needs scope", !priced && "Needs pricing"].filter(Boolean);
	const fieldId = (part: string) => `psu-stage-${stage.id}-${part}`;

	const name = useFieldValidation({
		problem: stage.name.trim() ? null : `Every ${itemLabel} needs a name.`,
		reveal: setupReveal,
		problemStatus: "required",
	});
	const scope = useFieldValidation({
		problem: scoped ? null : "Say what this delivers before the engagement is published.",
		reveal: setupReveal,
		problemStatus: "gate",
	});
	const price = useFieldValidation({
		problem: priced ? null : `This ${itemLabel} has no price yet.`,
		reveal: setupReveal,
		problemStatus: "gate",
	});

	const priceLabel = session
		? "Session price"
		: format === "pipeline"
		? "Ticket price"
		: "Fixed price";
	const seatMode = stage.seatLimit === null ? "unlimited" : "limited";

	const setDurationMode = (mode: StageDurationMode) => {
		props.onPatch({
			durationMode: mode,
			durationDays: mode === "relative_duration" ? stage.durationDays : null,
			dueDate: mode === "fixed_deadline" ? stage.dueDate : null,
		});
	};

	return (
		<li
			// deno-lint-ignore no-explicit-any
			ref={sortable.setNodeRef as any}
			class="psu-stage"
			data-open={props.open || undefined}
			data-dragging={sortable.isDragging.value || undefined}
			data-over={sortable.isOver.value || undefined}
		>
			<div class="psu-stage__row">
				<button
					type="button"
					class="psu-stage__grip"
					aria-label={`Reorder ${stage.name || itemLabel}`}
					aria-roledescription={sortable.attributes["aria-roledescription"]}
					tabIndex={sortable.attributes.tabIndex}
					onPointerDown={sortable.listeners.onPointerDown}
					onKeyDown={sortable.listeners.onKeyDown}
				>
					<Icon name="grip" />
				</button>

				<button
					type="button"
					class="psu-stage__main"
					aria-expanded={props.open}
					onClick={props.onToggle}
				>
					<span class="psu-stage__index" aria-hidden="true">{props.index + 1}</span>
					<span class="psu-stage__name">{stage.name || `Untitled ${itemLabel}`}</span>
					{outstandingNotes.length > 0 && (
						<span class="psu-stage__outstanding">{outstandingNotes.join(" · ")}</span>
					)}
					<span class="psu-stage__chev" aria-hidden="true">
						<Icon name={props.open ? "chevron-up" : "chevron-down"} />
					</span>
				</button>

				<button
					type="button"
					class="psu-stage__remove"
					aria-label={`Remove ${stage.name || itemLabel}`}
					onClick={props.onRemove}
				>
					<Icon name="trash" />
				</button>
			</div>

			{props.open && (
				<div class="psu-stage__body">
					<Field label="Name" htmlFor={fieldId("name")} validation={name}>
						<InputText
							id={fieldId("name")}
							aria-describedby={`${fieldId("name")}-problem`}
							value={stage.name}
							onValueChange={(next: string) => props.onPatch({ name: next })}
							block
							maxLength={120}
							placeholder="e.g. Discovery"
							status={name.status.value}
						/>
					</Field>

					<Field label="Scope" validation={scope}>
						<RichTextEditor
							key={stage.id}
							value={stage.description}
							onValueChange={(description: string) => props.onPatch({ description })}
							placeholder="Deliverables, acceptance criteria, delivery notes…"
							status={scope.status.value}
							minRows={3}
							aria-label={`Scope for ${stage.name || itemLabel}`}
						/>
					</Field>

					<div class="psu-row">
						<Field
							label={session ? "Duration" : "Delivery"}
							htmlFor={fieldId("milestone")}
						>
							<InputText
								id={fieldId("milestone")}
								value={stage.milestone}
								onValueChange={(milestone: string) => props.onPatch({ milestone })}
								block
								maxLength={240}
								placeholder={session ? "e.g. 60 minutes" : "e.g. 2 weeks"}
							/>
						</Field>

						<Field label={priceLabel} htmlFor={fieldId("price")} validation={price}>
							<InputNumber
								id={fieldId("price")}
								aria-describedby={`${fieldId("price")}-problem`}
								value={toMajor(stage.unitPriceCents)}
								onValueChange={(v: number | null) => props.onPatch({ unitPriceCents: toMinor(v) })}
								mode="currency"
								currency={props.currency}
								min={0}
								placeholder="Unpriced"
								status={price.status.value}
							/>
						</Field>
					</div>

					{!session && (
						<>
							<SubHead>What the work is</SubHead>

							<Field
								label="Steps"
								hint="Every ticket raised against this stage starts from this checklist."
							>
								<TaskListEditor
									tasks={asTaskRows(stage.tasks)}
									onChange={(next) => props.onPatch({ tasks: asStepLabels(next) })}
									label={`Steps for ${stage.name || itemLabel}`}
									placeholder="Add a step…"
									hideProgress
								/>
							</Field>

							<Field label="Required skills" hint="Up to ten, used to match freelancers.">
								<Chips
									value={stage.skills}
									onValueChange={(skills: string[]) => props.onPatch({ skills })}
									placeholder="Add a skill…"
									max={10}
									addOnBlur
									aria-label={`Required skills for ${stage.name || itemLabel}`}
								/>
							</Field>
						</>
					)}

					<SubHead>When it runs</SubHead>

					<div class="psu-row">
						<Field label="Due date">
							<Select
								options={optionsOf(DURATION_LABEL)}
								value={stage.durationMode}
								onValueChange={(v: string) => setDurationMode(v as StageDurationMode)}
								aria-label={`Due date for ${stage.name || itemLabel}`}
							/>
						</Field>

						{stage.durationMode === "relative_duration" && (
							<Field label="Days allowed" htmlFor={fieldId("days")}>
								<InputNumber
									id={fieldId("days")}
									value={stage.durationDays}
									onValueChange={(v: number | null) =>
										props.onPatch({ durationDays: v === null ? null : Math.max(0, Math.round(v)) })}
									min={0}
									max={3650}
									placeholder="e.g. 14"
								/>
							</Field>
						)}

						{stage.durationMode === "fixed_deadline" && (
							<Field label="Deadline">
								<DatePicker
									value={toDate(stage.dueDate)}
									onValueChange={(v: DateValue) => props.onPatch({ dueDate: toIsoInstant(v) })}
									aria-label={`Deadline for ${stage.name || itemLabel}`}
								/>
							</Field>
						)}
					</div>

					{!session && (
						<>
							<SubHead>Who works it</SubHead>

							<div class="psu-row">
								<Field label="Seats" hint="How many freelancers may hold this stage at once.">
									<SelectButton
										options={SEAT_MODE_OPTIONS}
										value={seatMode}
										onValueChange={(v: string | string[]) =>
											props.onPatch({
												seatLimit: v === "unlimited" ? null : DEFAULT_STAGE_SETUP.seatLimit,
											})}
										aria-label={`Seats on ${stage.name || itemLabel}`}
									/>
								</Field>

								{stage.seatLimit !== null && (
									<Field label="Seat count" htmlFor={fieldId("seats")}>
										<InputNumber
											id={fieldId("seats")}
											value={stage.seatLimit}
											onValueChange={(v: number | null) =>
												props.onPatch({
													seatLimit: v === null ? null : Math.max(1, Math.round(v)),
												})}
											min={1}
											placeholder="3"
										/>
									</Field>
								)}
							</div>

							{props.index > 0 && (
								<>
									<Field label="Starts after">
										<Select
											options={dependencyOptions(props.stages, props.index, itemLabel)}
											value={stage.dependsOnStageIndex === null
												? NO_DEPENDENCY
												: String(stage.dependsOnStageIndex)}
											onValueChange={(v: string) =>
												props.onPatch({
													dependsOnStageIndex: v === NO_DEPENDENCY ? null : Number.parseInt(v, 10),
												})}
											aria-label={`What ${stage.name || itemLabel} starts after`}
										/>
									</Field>

									{stage.dependsOnStageIndex !== null && (
										<div class="psu-row">
											<Field label="Lag" htmlFor={fieldId("lag")}>
												<InputNumber
													id={fieldId("lag")}
													value={stage.lagDays}
													onValueChange={(v: number | null) =>
														props.onPatch({
															lagDays: v === null ? 0 : Math.min(365, Math.max(0, Math.round(v))),
														})}
													min={0}
													max={365}
													suffix=" days"
													placeholder="0"
												/>
											</Field>
											<div class="psu-field">
												<ToggleSwitch
													value={stage.parallel}
													onValueChange={(parallel: boolean) => props.onPatch({ parallel })}
													label="Run alongside it rather than after it"
												/>
											</div>
										</div>
									)}
								</>
							)}
						</>
					)}

					<Advanced summary="Submission rules">
						<div class="psu-toggles">
							<Checkbox
								value={stage.requiresFiles}
								onValueChange={(requiresFiles: boolean) => props.onPatch({ requiresFiles })}
								label="A submission must carry a file"
							/>
							<Checkbox
								value={stage.ndaOverride}
								onValueChange={(ndaOverride: boolean) => props.onPatch({ ndaOverride })}
								label="Stricter confidentiality than the rest of the project"
							/>
						</div>

						<Field
							label="Accepted file types"
							hint="Leave empty to accept anything."
						>
							<MultiSelect
								options={FILE_CATEGORY_OPTIONS}
								value={stage.allowedFileCategories}
								onValueChange={(next: string[]) =>
									props.onPatch({
										allowedFileCategories: next as StageSetup["allowedFileCategories"],
									})}
								placeholder="Any type"
								filter
								showClear
								maxSelectedLabels={3}
								aria-label={`Accepted file types for ${stage.name || itemLabel}`}
							/>
						</Field>

						<Field
							label="Accepted extensions"
							hint="Narrower still — name them without the dot, e.g. psd."
						>
							<Chips
								value={stage.allowedFileExtensions}
								onValueChange={(allowedFileExtensions: string[]) =>
									props.onPatch({ allowedFileExtensions })}
								placeholder="Add an extension…"
								max={50}
								addOnBlur
								aria-label={`Accepted extensions for ${stage.name || itemLabel}`}
							/>
						</Field>
					</Advanced>
				</div>
			)}
		</li>
	);
}

/** The stage / milestone / session list, drag-reorderable, with each row's own configuration. */
export function StageListSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const open = useSignal<string | null>(setup.stages[0]?.id ?? null);
	const itemLabel = STAGE_ITEM_LABEL[setup.format];

	const add = () => {
		const id = newStageId();
		const ordinal = setup.stages.length + 1;
		patchSetup({
			stages: [...setup.stages, {
				...DEFAULT_STAGE_SETUP,
				id,
				name: `${itemLabel[0].toUpperCase()}${itemLabel.slice(1)} ${ordinal}`,
				order: setup.stages.length,
			}],
		});
		open.value = id;
	};

	const patchRow = (id: string, patch: Partial<StageSetup>) => {
		patchSetup({ stages: setup.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
	};

	const remove = (id: string) => {
		patchSetup({
			stages: remapDependencies(setup.stages, setup.stages.filter((s) => s.id !== id)),
		});
		if (open.value === id) open.value = null;
	};

	const reorder = (activeId: string | null, overId: string | null) => {
		if (!activeId || !overId || activeId === overId) return;
		const strip = (id: string) => id.replace("stage:", "");
		const from = setup.stages.findIndex((s) => s.id === strip(activeId));
		const to = setup.stages.findIndex((s) => s.id === strip(overId));
		if (from === -1 || to === -1) return;
		patchSetup({
			stages: remapDependencies(setup.stages, arrayMove(setup.stages, from, to)),
		});
	};

	return (
		<Section title={staffingSectionLabel(setup)} hint={hint}>
			<DndContext onDragEnd={(e) => reorder(e.active.id, e.canceled ? null : e.over)}>
				<ul class="psu-list" aria-label={staffingSectionLabel(setup)}>
					{setup.stages.map((stage, index) => (
						<StageRow
							key={stage.id}
							stage={stage}
							index={index}
							stages={setup.stages}
							itemLabel={itemLabel}
							format={setup.format}
							currency={setup.budget.currency}
							open={open.value === stage.id}
							onToggle={() => (open.value = open.value === stage.id ? null : stage.id)}
							onPatch={(patch) => patchRow(stage.id, patch)}
							onRemove={() => remove(stage.id)}
						/>
					))}
					{setup.stages.length === 0 && (
						<li class="psu-list__empty">
							No {itemLabel}s yet. Freelancers cannot be hired until there is at least one.
						</li>
					)}
				</ul>
			</DndContext>

			<button type="button" class="psu-add" onClick={add}>
				<Icon name="plus" />
				Add {itemLabel}
			</button>
		</Section>
	);
}
// #endregion

// #region Role list
/** One staffing role: a name, the skills it needs and what it is worth. */
function RoleRow(props: {
	role: ProjectRoleSetup;
	currency: string;
	budgetOutstanding: boolean;
	onPatch: (patch: Partial<ProjectRoleSetup>) => void;
	onRemove: () => void;
}): JSX.Element {
	const { role } = props;
	const fieldId = (part: string) => `psu-role-${role.id}-${part}`;
	const name = useFieldValidation({
		problem: role.name.trim() ? null : "Every team role needs a name.",
		reveal: setupReveal,
		problemStatus: "required",
	});
	const budget = useFieldValidation({
		problem: props.budgetOutstanding && role.budgetCents === null
			? "Give this role a budget, or set one for the project."
			: null,
		reveal: setupReveal,
		problemStatus: "gate",
	});

	return (
		<li class="psu-role">
			<div class="psu-role__head">
				<Field label="Role name" htmlFor={fieldId("name")} validation={name}>
					<InputText
						id={fieldId("name")}
						aria-describedby={`${fieldId("name")}-problem`}
						value={role.name}
						onValueChange={(next: string) => props.onPatch({ name: next })}
						block
						maxLength={120}
						placeholder="e.g. Lead designer"
						status={name.status.value}
					/>
				</Field>
				<button
					type="button"
					class="psu-stage__remove"
					aria-label={`Remove ${role.name || "role"}`}
					onClick={props.onRemove}
				>
					<Icon name="trash" />
				</button>
			</div>

			<div class="psu-row">
				<Field label="Skills">
					<Chips
						value={role.skills}
						onValueChange={(skills: string[]) => props.onPatch({ skills })}
						placeholder="Add a skill…"
						max={20}
						addOnBlur
						aria-label={`Skills for ${role.name || "role"}`}
					/>
				</Field>
				<Field label="Role budget" htmlFor={fieldId("budget")} validation={budget}>
					<InputNumber
						id={fieldId("budget")}
						aria-describedby={`${fieldId("budget")}-problem`}
						value={toMajor(role.budgetCents)}
						onValueChange={(v: number | null) => props.onPatch({ budgetCents: toMinor(v) })}
						mode="currency"
						currency={props.currency}
						min={0}
						placeholder="Unpriced"
						status={budget.status.value}
					/>
				</Field>
			</div>
		</li>
	);
}

/** The staffing roles a Direct Deliverable takes instead of a stage run. */
export function RoleListSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const budgetOutstanding = outstanding(setup, "pricing");

	const add = () => {
		patchSetup({
			roles: [...setup.roles, {
				id: newRoleId(),
				name: `Role ${setup.roles.length + 1}`,
				skills: [],
				budgetCents: null,
			}],
		});
	};

	const patchRow = (id: string, patch: Partial<ProjectRoleSetup>) => {
		patchSetup({ roles: setup.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
	};

	const remove = (id: string) => {
		patchSetup({ roles: setup.roles.filter((r) => r.id !== id) });
	};

	return (
		<Section title={ROLE_SECTION_LABEL} hint={hint}>
			<ul class="psu-list" aria-label={ROLE_SECTION_LABEL}>
				{setup.roles.map((role) => (
					<RoleRow
						key={role.id}
						role={role}
						currency={setup.budget.currency}
						budgetOutstanding={budgetOutstanding}
						onPatch={(patch) => patchRow(role.id, patch)}
						onRemove={() => remove(role.id)}
					/>
				))}
				{setup.roles.length === 0 && (
					<li class="psu-list__empty">
						No roles yet. A direct deliverable is staffed by roles rather than by stages.
					</li>
				)}
			</ul>

			<button type="button" class="psu-add" onClick={add}>
				<Icon name="plus" />
				Add role
			</button>
		</Section>
	);
}
// #endregion

// #region Rules
/**
 * The terms the engagement is offered under — every one of them a term a freelancer agrees to.
 *
 * Confidentiality is ONE control, not two. `nda_required` is kept as a column because existing
 * consumers read it, but it is derived (`ndaRequiredFor`), and a checkbox beside the mode would be a
 * second way to answer one question — the two would eventually be set to contradict each other, and
 * nothing on the surface could say which one governed the work. Changing the mode also drops a custom
 * document the engagement no longer uses, mirroring `ck_projects_nda_document` so the same edit
 * cannot be refused by the database it was just accepted by the form.
 *
 * The deadline-bonus offer is pipeline-only (`ck_projects_deadline_bonus_format`), so on any other
 * shape it is not rendered at all: this is a capability the engagement does not have rather than one
 * its owner has not reached, and absence is how the design system says so.
 */
export function RulesSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const rules = setup.rules;

	const setNdaMode = (mode: NdaMode) => {
		patchSetup({
			rules: {
				ndaMode: mode,
				ndaRequired: ndaRequiredFor(mode),
				ndaDocumentId: ndaDocumentFor(mode, rules.ndaDocumentId),
			},
		});
	};

	return (
		<Section title="Rules" hint={hint}>
			<div class="psu-row">
				<Field
					label="Visibility"
					hint="A public engagement is listed once every required step is done."
				>
					<Select
						options={optionsOf(VISIBILITY_LABEL)}
						value={rules.visibility}
						onValueChange={(v: string) =>
							patchSetup({ rules: { visibility: v as ProjectVisibility } })}
						aria-label="Visibility"
					/>
				</Field>
				<Field label="Timeline">
					<Select
						options={optionsOf(TIMELINE_LABEL)}
						value={rules.timelinePreset}
						onValueChange={(v: string) =>
							patchSetup({ rules: { timelinePreset: v as TimelinePreset } })}
						aria-label="Timeline"
					/>
				</Field>
			</div>

			<div class="psu-row">
				<Field label="Ownership of the work">
					<Select
						options={optionsOf(IP_LABEL)}
						value={rules.ipOwnershipMode}
						onValueChange={(v: string) =>
							patchSetup({ rules: { ipOwnershipMode: v as IpOwnershipMode } })}
						aria-label="Ownership of the work"
					/>
				</Field>
				<Field label="Portfolio rights">
					<Select
						options={optionsOf(PORTFOLIO_LABEL)}
						value={rules.portfolioDisplayRights}
						onValueChange={(v: string) =>
							patchSetup({ rules: { portfolioDisplayRights: v as PortfolioDisplayRights } })}
						aria-label="Portfolio rights"
					/>
				</Field>
			</div>

			<div class="psu-row">
				<Field label="Confidentiality">
					<Select
						options={optionsOf(NDA_LABEL)}
						value={rules.ndaMode}
						onValueChange={(v: string) => setNdaMode(v as NdaMode)}
						aria-label="Confidentiality"
					/>
				</Field>
				{rules.ndaMode === "custom" && (
					<Field
						label="Agreement document"
						htmlFor="psu-nda-document"
						hint="The id of a document in your files. Freelancers sign it before they can start."
					>
						<InputText
							id="psu-nda-document"
							value={rules.ndaDocumentId ?? ""}
							onValueChange={(next: string) =>
								patchSetup({ rules: { ndaDocumentId: next.trim() === "" ? null : next.trim() } })}
							block
							maxLength={64}
							placeholder="Not attached yet"
						/>
					</Field>
				)}
			</div>

			<div class="psu-row">
				<Field
					label="Locations"
					hint="Leave empty to accept freelancers anywhere."
				>
					<Chips
						value={rules.locationRestriction}
						onValueChange={(locationRestriction: string[]) =>
							patchSetup({ rules: { locationRestriction } })}
						placeholder="Add a location…"
						max={20}
						addOnBlur
						aria-label="Locations"
					/>
				</Field>
				<Field label="Languages" hint="Leave empty to accept any language.">
					<Chips
						value={rules.languageRequirement}
						onValueChange={(languageRequirement: string[]) =>
							patchSetup({ rules: { languageRequirement } })}
						placeholder="Add a language…"
						max={20}
						addOnBlur
						aria-label="Languages"
					/>
				</Field>
			</div>

			{setup.format === "pipeline" && (
				<div class="psu-toggles">
					<ToggleSwitch
						value={rules.allowDeadlineBonuses}
						onValueChange={(allowDeadlineBonuses: boolean) =>
							patchSetup({ rules: { allowDeadlineBonuses } })}
						label={`Offer an uplift for early delivery — ${DEADLINE_BONUS_PERCENT}% of the ticket price`}
					/>
				</div>
			)}
		</Section>
	);
}
// #endregion

// #region Dispatch
/** The ladder hint for a section's requirement, or `undefined` once it is satisfied. */
export function hintFor(setup: ProjectSetup, key: ProjectSetupStepKey): string | undefined {
	const step = setup.steps.find((s) => s.key === key);
	if (!step || step.done || !step.hint) return undefined;
	return step.hint;
}

/** Render one section by key, wired to the ladder hint that measures it. */
export function SetupSection(
	{ setup, section }: { setup: ProjectSetup; section: SetupSectionKey },
): JSX.Element | null {
	switch (section) {
		case "basics":
			return <BasicsSection setup={setup} hint={hintFor(setup, "title")} />;
		case "description":
			return <DescriptionSection setup={setup} hint={hintFor(setup, "description")} />;
		case "budget":
			return <BudgetSection setup={setup} hint={hintFor(setup, "pricing")} />;
		case "stages":
			return <StageListSection setup={setup} hint={hintFor(setup, "stages")} />;
		case "roles":
			return <RoleListSection setup={setup} hint={hintFor(setup, "roles")} />;
		case "rules":
			return <RulesSection setup={setup} hint={hintFor(setup, "rules")} />;
	}
	return null;
}
// #endregion
