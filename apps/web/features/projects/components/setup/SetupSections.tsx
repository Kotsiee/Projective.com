import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	Checkbox,
	Chips,
	InputNumber,
	InputText,
	MultiSelect,
	type Option,
	Select,
	SelectButton,
	ToggleSwitch,
} from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { DndContext, useSortable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import { currencyExponent, DISPLAY_CURRENCIES, toMinorUnits } from "@projective/types/finance";
import { FileKind } from "@projective/types/files";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import { extractMetadata } from "@web/features/files/core/media/extract.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { AccountService } from "@web/features/shell/core/AccountService.ts";
import {
	blankStage,
	hasStages,
	MAX_PROJECT_ATTACHMENTS,
	normaliseSeats,
	ROLE_SECTION_LABEL,
	STAGE_ITEM_LABEL,
	structureForStages,
} from "../../types/projects-types.ts";
import type {
	IpOwnershipMode,
	NdaDocumentSource,
	PortfolioDisplayRights,
	ProjectAttachment,
	ProjectFormat,
	ProjectRoleSetup,
	ProjectSetup,
	ProjectSetupStepKey,
	ProjectVisibility,
	StageCapacity,
	StageDependency,
	StageSetup,
	StageStaffingRole,
	StageTask,
	TimelinePreset,
} from "../../types/projects-types.ts";
import {
	anchorId,
	budgetSectionLabel,
	type SetupSectionKey,
	staffingSectionLabel,
} from "../../core/setup-sections.ts";
import { patchSetup } from "../../core/setup-state.ts";
import { FieldGuard, fieldStatus } from "../../core/setup-validation.ts";
import { formatBytes } from "../../core/composer-model.ts";
import { uploadForProject } from "../../core/upload.ts";

/**
 * SetupSections — the Stage-2 workspace's form body: every section of the owner's configuration, and
 * the controls that edit it.
 *
 * The sections are ONE continuous vertical flow, not a stepper. A stepper implies an order the work
 * does not have — a client who knows the budget and not the brief has no reason to be stopped at
 * step 2 — and it hides the scale of what is being asked, which is the one thing a person deciding
 * whether to finish now needs to see. The side rail beside this flow is an accelerator over the same
 * scroll, and it addresses each section through {@link anchorId}, which is why every `Section` here
 * carries the registry's id rather than one of its own.
 *
 * The four format branches are one component set with a dispatcher rather than four screens, because
 * the difference between a Pipeline and a Direct Deliverable is WHICH sections apply, not how a
 * section behaves: a stage list relabelled "Milestones" is the same editor, and forking it would give
 * a milestone its own chance to drift away from a stage.
 *
 * Every control is a `@projective/ui/fields` primitive and every edit routes through
 * {@link patchSetup}, so the ladder in the header band re-derives from the same `reconcileSetup` the
 * server runs. Nothing here computes a percentage, a total or a gate.
 *
 * Static content is never boxed and non-actionable metadata is never a chip (DESIGN_SYSTEM §B.4,
 * §B.11): a section is separated by spacing alone, and a stage's outstanding requirements read as
 * inline middot-separated text rather than as pills that look pressable and are not.
 */

// #region Section vocabulary
/**
 * The section list lives in `core/setup-sections.ts` and is re-exported rather than restated.
 *
 * There is exactly one list because two hydration roots consume it: this form renders the sections,
 * and the side rail renders a jump per section. A second list here would still compile, still look
 * right and still leave the rail pointing at an anchor that no longer exists — the §3 gate-11 defect,
 * invisible to a type-checker.
 */
export {
	anchorId,
	budgetSectionLabel,
	setupSections,
	staffingSectionLabel,
} from "../../core/setup-sections.ts";
export type { SetupSectionKey, SetupSectionMeta } from "../../core/setup-sections.ts";
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

const FILE_KIND_LABEL: Record<string, string> = {
	image: "Images",
	video: "Video",
	audio: "Audio",
	pdf: "PDF",
	doc: "Documents",
	code: "Code",
	archive: "Archives",
	link: "Links",
	file: "Any other file",
};

/** Turn an exhaustive label map into the `Option[]` a `Select` takes, in declaration order. */
function optionsOf<K extends string>(labels: Record<K, string>): Option[] {
	return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}

/**
 * The two work-flows a client can commission, plus `session` when the engagement ALREADY is one.
 *
 * A session is a service a freelancer sells, not a project a client posts — which is why the Quick-Init
 * modal's `ProjectCreateFormat` has two members. Offering it here as a target would reintroduce
 * exactly what the modal refuses: a buyer minting an engagement with no seller and no schedule. An
 * existing session still has to be editable, so the option appears only on a project that is one, and
 * is then the value it is already set to rather than a destination.
 */
function formatOptions(format: ProjectFormat): Option[] {
	const base: Option[] = [
		{ value: "pipeline", label: "Pipeline" },
		{ value: "one_off", label: "One-off" },
	];
	return format === "session" ? [...base, { value: "session", label: "Sessions" }] : base;
}

const FORMAT_HINT: Record<ProjectFormat, string> = {
	pipeline: "A multi-stage workflow. Freelancers claim tickets stage by stage.",
	one_off: "A fixed engagement delivered against milestones.",
	session: "Booked time rather than tickets — one-to-one or a cohort.",
};

const SHAPE_OPTIONS: Option[] = [
	{ value: "one_off", label: "Milestones" },
	{ value: "single_task", label: "Direct deliverable" },
];

const SESSION_KIND_OPTIONS: Option[] = [
	{ value: "normal", label: "One-to-one" },
	{ value: "group", label: "Group" },
];

const BUDGET_TYPE_OPTIONS: Option[] = [
	{ value: "fixed_price", label: "Fixed price" },
	{ value: "hourly_cap", label: "Hourly cap" },
];

const DEPENDENCY_OPTIONS: Option[] = [
	{ value: "sequential", label: "After the previous one" },
	{ value: "parallel", label: "Alongside the project" },
];

const CAPACITY_OPTIONS: Option[] = [
	{ value: "unlimited", label: "Open to anyone" },
	{ value: "limited", label: "Fixed seats" },
];

/**
 * Every currency the platform can price in, from the SSOT's curated list.
 *
 * Not a hand-written subset: an amount stored in a currency the dropdown does not carry renders a
 * `Select` whose value matches no option, and the owner then cannot change it back to one that does.
 * The list is curated upstream precisely so every entry has a seeded rate behind it.
 */
const CURRENCY_OPTIONS: Option[] = DISPLAY_CURRENCIES.map((c) => ({
	value: c.code,
	label: `${c.code} — ${c.label}`,
}));

const FILE_KIND_OPTIONS: Option[] = FileKind.options.map((kind) => ({
	value: kind,
	label: FILE_KIND_LABEL[kind] ?? kind,
}));

/**
 * Languages and locations are picked from curated lists rather than typed free-hand.
 *
 * Both are MATCHING criteria: discovery ranks a freelancer against them, so "Spanish" and "spanish"
 * and "ES" typed into three projects are three requirements that never meet the same person. A fixed
 * vocabulary is what makes the restriction mean anything, and an empty selection stays the legitimate
 * answer "anywhere" / "any language" rather than an omission.
 */
const LANGUAGE_OPTIONS: Option[] = [
	"English",
	"Spanish",
	"French",
	"German",
	"Portuguese",
	"Italian",
	"Dutch",
	"Polish",
	"Arabic",
	"Hindi",
	"Bengali",
	"Mandarin",
	"Cantonese",
	"Japanese",
	"Korean",
	"Vietnamese",
	"Indonesian",
	"Turkish",
	"Russian",
	"Ukrainian",
	"Swedish",
	"Norwegian",
	"Danish",
	"Finnish",
	"Hebrew",
	"Swahili",
].map((v) => ({ value: v, label: v }));

const LOCATION_OPTIONS: Option[] = [
	{ value: "United Kingdom", label: "United Kingdom", group: "Europe" },
	{ value: "Ireland", label: "Ireland", group: "Europe" },
	{ value: "Germany", label: "Germany", group: "Europe" },
	{ value: "France", label: "France", group: "Europe" },
	{ value: "Spain", label: "Spain", group: "Europe" },
	{ value: "Portugal", label: "Portugal", group: "Europe" },
	{ value: "Italy", label: "Italy", group: "Europe" },
	{ value: "Netherlands", label: "Netherlands", group: "Europe" },
	{ value: "Poland", label: "Poland", group: "Europe" },
	{ value: "European Union", label: "Anywhere in the EU", group: "Europe" },
	{ value: "United States", label: "United States", group: "Americas" },
	{ value: "Canada", label: "Canada", group: "Americas" },
	{ value: "Mexico", label: "Mexico", group: "Americas" },
	{ value: "Brazil", label: "Brazil", group: "Americas" },
	{ value: "Argentina", label: "Argentina", group: "Americas" },
	{ value: "India", label: "India", group: "Asia-Pacific" },
	{ value: "Singapore", label: "Singapore", group: "Asia-Pacific" },
	{ value: "Japan", label: "Japan", group: "Asia-Pacific" },
	{ value: "Australia", label: "Australia", group: "Asia-Pacific" },
	{ value: "New Zealand", label: "New Zealand", group: "Asia-Pacific" },
	{ value: "United Arab Emirates", label: "United Arab Emirates", group: "Middle East & Africa" },
	{ value: "South Africa", label: "South Africa", group: "Middle East & Africa" },
	{ value: "Nigeria", label: "Nigeria", group: "Middle East & Africa" },
	{ value: "Kenya", label: "Kenya", group: "Middle East & Africa" },
];
// #endregion

// #region Money conversion
/**
 * Minor units to the major units a person types, and back — in the PROJECT'S OWN currency.
 *
 * The exponent is looked up rather than assumed to be 2. A fixed `/100` is correct for most of the
 * offerable set and wrong for the rest: a ¥250,000 engagement stored as 250000 minor units would be
 * shown as ¥2,500 and written back as ¥25,000,000, which is a hundredfold escrow error committed
 * silently by a control the owner never touched.
 *
 * The schema stores minor units because a currency amount held as a float eventually loses a penny;
 * the field shows major units because that is what the owner is quoting. The rounding happens once,
 * on the way in.
 */
function toMajor(minor: number | null, currency: string): number | null {
	if (minor === null) return null;
	return minor / 10 ** currencyExponent(currency);
}

// #endregion

// #region Layout primitives
/**
 * One labelled section of the flow.
 *
 * The `id` comes from the shared registry, so the rail's `#psu-budget` and this element are one
 * string decided in one place. It is also what makes a plain `#hash` in the address bar land
 * correctly with JavaScript off, which the stylesheet's `scroll-margin-block-start` then clears the
 * pinned chrome for.
 *
 * Separated by SPACING alone (§B.4 tier 1) — no box, no hairline. A section of prose and inputs is
 * static content, and the asymmetric rhythm above and below the heading already says where each one
 * begins.
 */
export function Section(props: {
	/** Which registry section this is — the anchor the side rail jumps to. */
	sectionKey: SetupSectionKey;
	title: string;
	/** The ladder hint for this section, shown only while the requirement is outstanding. */
	hint?: string;
	children: ComponentChildren;
}): JSX.Element {
	return (
		<section id={anchorId(props.sectionKey)} class="psu-section">
			<div class="psu-section__head">
				<h2 class="psu-section__title">{props.title}</h2>
				{props.hint && <p class="psu-section__hint">{props.hint}</p>}
			</div>
			<div class="psu-section__body">{props.children}</div>
		</section>
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
 *
 * `fieldKey` opts the control into blur-gated validation. It is optional because most fields here
 * have no failing verdict to gate — a dropdown with a default is never wrong — and a guard around
 * one of those would only add a wrapper element.
 */
export function Field(props: {
	label: string;
	htmlFor?: string;
	hint?: string;
	/** Track focus/blur under this key so `fieldStatus` can hold a verdict back until the owner leaves. */
	fieldKey?: string;
	children: ComponentChildren;
}): JSX.Element {
	const body = (
		<>
			{props.htmlFor
				? <label class="psu-field__label" for={props.htmlFor}>{props.label}</label>
				: <span class="psu-field__label">{props.label}</span>}
			{props.children}
			{props.hint && <p class="psu-field__hint">{props.hint}</p>}
		</>
	);

	return props.fieldKey
		? <FieldGuard fieldKey={props.fieldKey} class="psu-field">{body}</FieldGuard>
		: <div class="psu-field">{body}</div>;
}

/** A note beneath a group of controls — prose, never a chip, never boxed. */
function Note({ children }: { children: ComponentChildren }): JSX.Element {
	return <p class="psu-note">{children}</p>;
}
// #endregion

// #region Draft identity
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

/** Task and per-stage-role rows are nested inside a stage, so their ids only have to be unique here. */
function newRowId(prefix: string): string {
	draftSeq += 1;
	return `${prefix}-${draftSeq}`;
}

function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
	const next = arr.slice();
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}
// #endregion

// #region Basics
/**
 * The three shape axes, held consistent in ONE patch.
 *
 * `structure` and `sessionKind` are each meaningful inside one format only, so a format change that
 * left either behind would let the ladder and the section set disagree about what is being sold. The
 * owner's has-stages decision is CARRIED ACROSS the change rather than reset — switching a staged
 * pipeline to a one-off is a change of flow, not a statement that the milestones should be discarded.
 */
function normalisedShape(
	setup: ProjectSetup,
	format: ProjectFormat,
): Pick<ProjectSetup, "format" | "structure" | "sessionKind"> {
	if (format === "one_off" && setup.structure === "single_task") {
		return { format, structure: "single_task", sessionKind: "none" };
	}
	return {
		format,
		structure: structureForStages(hasStages(setup.structure), format),
		sessionKind: format === "session"
			? (setup.sessionKind === "group" ? "group" : "normal")
			: "none",
	};
}

/** Identity and shape. */
export function BasicsSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	return (
		<Section sectionKey="basics" title="Basics" hint={hint}>
			<Field label="Project name" htmlFor="psu-title" fieldKey="title">
				<InputText
					id="psu-title"
					value={setup.title}
					onValueChange={(title: string) => patchSetup({ title })}
					placeholder="Name the engagement"
					block
					maxLength={160}
					status={fieldStatus("title", setup.title.trim() ? "default" : "required")}
				/>
			</Field>

			<Field label="Project type" hint={FORMAT_HINT[setup.format]}>
				<SelectButton
					options={formatOptions(setup.format)}
					value={setup.format}
					onValueChange={(v: string | string[]) =>
						patchSetup(normalisedShape(setup, v as ProjectFormat))}
					aria-label="Project type"
				/>
			</Field>

			{setup.format === "one_off" && (
				<Field
					label="Shape"
					hint="A direct deliverable is staffed by roles rather than run through milestones."
				>
					<SelectButton
						options={SHAPE_OPTIONS}
						value={setup.structure === "single_task" ? "single_task" : "one_off"}
						onValueChange={(v: string | string[]) =>
							patchSetup({
								structure: v === "single_task"
									? "single_task"
									: structureForStages(true, "one_off"),
							})}
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
	return (
		<Section sectionKey="description" title="Description" hint={hint}>
			{
				/*
				 * Keyed on the uuid, never the slug. Quill owns its DOM after mount, so the key decides
				 * when the editor is rebuilt — and a title-derived slug moves on the first rename, which
				 * would tear down and re-seed the editor in the middle of the sentence that caused it.
				 */
			}
			<RichTextEditor
				key={setup.id}
				value={setup.description}
				onValueChange={(description: string) => patchSetup({ description })}
				placeholder="Describe the work, its goals and its context…"
				status={setup.description.trim() ? "default" : "gate"}
				minRows={5}
				aria-label="Project description"
			/>
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
 */
export function BudgetSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const session = setup.format === "session";
	const currency = setup.budget.currency;
	const exponent = currencyExponent(currency);

	return (
		<Section sectionKey="budget" title={budgetSectionLabel(setup)} hint={hint}>
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

				<Field
					label={session ? "Rate per session" : "Amount"}
					htmlFor="psu-budget-amount"
					fieldKey="budget.amount"
				>
					<InputNumber
						id="psu-budget-amount"
						value={toMajor(setup.budget.amountCents, currency)}
						onValueChange={(v: number | null) =>
							patchSetup({ budget: { amountCents: toMinorUnits(v, currency) } })}
						mode="currency"
						currency={currency}
						maxFractionDigits={exponent}
						minFractionDigits={exponent}
						min={0}
						placeholder="Not set"
						status={fieldStatus(
							"budget.amount",
							setup.budget.amountCents === null ? "gate" : "default",
						)}
					/>
				</Field>
			</div>

			<Field
				label="Currency"
				hint="Every figure on this page is priced in it. Changing it relabels those figures; it does not convert them."
			>
				<Select
					options={CURRENCY_OPTIONS}
					value={currency}
					onValueChange={(next: string) => patchSetup({ budget: { currency: next } })}
					filter
					aria-label="Currency"
				/>
			</Field>

			{session && (
				<Note>
					{setup.stages.length === 0
						? "No sessions scheduled yet."
						: `${setup.stages.length} session${setup.stages.length === 1 ? "" : "s"} scheduled`}
					{" · each session carries its own duration below"}
				</Note>
			)}
		</Section>
	);
}
// #endregion

// #region Stage sub-editors
/** The default checklist a ticket on a stage is seeded from. */
function TaskList(props: {
	stage: StageSetup;
	itemLabel: string;
	onPatch: (patch: Partial<StageSetup>) => void;
}): JSX.Element {
	const { stage } = props;

	const patchTask = (id: string, text: string) => {
		props.onPatch({ tasks: stage.tasks.map((t) => (t.id === id ? { ...t, text } : t)) });
	};

	return (
		<Field
			label="Default task list"
			hint="Every ticket opened on this stage starts with these steps."
		>
			<ul class="psu-rows" role="list">
				{stage.tasks.map((task: StageTask, index: number) => (
					<li key={task.id} class="psu-rows__row">
						<InputText
							value={task.text}
							onValueChange={(text: string) =>
								patchTask(task.id, text)}
							block
							maxLength={240}
							placeholder={`Step ${index + 1}`}
							aria-label={`Step ${index + 1}`}
							status={task.text.trim() ? "default" : "required"}
						/>
						<button
							type="button"
							class="psu-stage__remove"
							aria-label={`Remove step ${index + 1}`}
							onClick={() =>
								props.onPatch({ tasks: stage.tasks.filter((t) => t.id !== task.id) })}
						>
							<Icon name="trash" />
						</button>
					</li>
				))}
			</ul>
			<button
				type="button"
				class="psu-add psu-add--sm"
				onClick={() => props.onPatch({
					tasks: [...stage.tasks, { id: newRowId("task"), text: "" }],
				})}
			>
				<Icon name="plus" />
				Add step
			</button>
		</Field>
	);
}

/**
 * Named roles this stage staffs.
 *
 * Distinct from the project-level roles a Direct Deliverable takes: these hang off one stage, and a
 * project may have several sets of them. An empty list is a real answer — the stage is then an
 * unnamed pool governed by its seat settings alone.
 */
function StageRoleList(props: {
	stage: StageSetup;
	currency: string;
	onPatch: (patch: Partial<StageSetup>) => void;
}): JSX.Element {
	const { stage, currency } = props;
	const exponent = currencyExponent(currency);

	const patchRole = (id: string, patch: Partial<StageStaffingRole>) => {
		props.onPatch({ roles: stage.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
	};

	return (
		<Field
			label="Named roles"
			hint="Leave empty to staff this stage from one open pool instead."
		>
			<ul class="psu-rows" role="list">
				{stage.roles.map((role: StageStaffingRole) => {
					const key = `stage:${stage.id}:role:${role.id}:name`;
					return (
						<li key={role.id} class="psu-rows__row psu-rows__row--wrap">
							<FieldGuard fieldKey={key} class="psu-rows__grow">
								<InputText
									value={role.name}
									onValueChange={(name: string) => patchRole(role.id, { name })}
									block
									maxLength={120}
									placeholder="e.g. Lead designer"
									aria-label="Role name"
									status={fieldStatus(key, role.name.trim() ? "default" : "required")}
								/>
							</FieldGuard>
							<InputNumber
								value={role.quantity}
								onValueChange={(v: number | null) =>
									patchRole(role.id, { quantity: Math.max(1, Math.min(99, Math.round(v ?? 1))) })}
								min={1}
								max={99}
								showButtons
								aria-label={`How many ${role.name || "people"}`}
							/>
							<InputNumber
								value={toMajor(role.budgetCents, currency)}
								onValueChange={(v: number | null) =>
									patchRole(role.id, { budgetCents: toMinorUnits(v, currency) })}
								mode="currency"
								currency={currency}
								maxFractionDigits={exponent}
								minFractionDigits={exponent}
								min={0}
								placeholder="Unpriced"
								aria-label="Role budget"
							/>
							<button
								type="button"
								class="psu-stage__remove"
								aria-label={`Remove ${role.name || "role"}`}
								onClick={() =>
									props.onPatch({ roles: stage.roles.filter((r) => r.id !== role.id) })}
							>
								<Icon name="trash" />
							</button>
						</li>
					);
				})}
			</ul>
			<button
				type="button"
				class="psu-add psu-add--sm"
				onClick={() =>
					props.onPatch({
						roles: [...stage.roles, {
							id: newRowId("srole"),
							name: "",
							quantity: 1,
							budgetCents: null,
						}],
					})}
			>
				<Icon name="plus" />
				Add role
			</button>
		</Field>
	);
}

/**
 * The per-stage NDA override, as THREE states.
 *
 * `null` inherits the project's own term, which is not the same as "not required": a copied boolean
 * goes stale the moment the project-level term changes, and nothing would then say which of the two
 * the stage actually meant. So the control offers Inherit / Required / Not required, and Inherit is
 * what a stage nobody has thought about carries.
 */
function ndaOverrideOptions(projectRequiresNda: boolean): Option[] {
	return [
		{
			value: "inherit",
			label: `Follow the project (${projectRequiresNda ? "NDA required" : "no NDA"})`,
		},
		{ value: "required", label: "Require an NDA for this stage" },
		{ value: "none", label: "No NDA for this stage" },
	];
}

function ndaOverrideValue(value: boolean | null): string {
	if (value === null) return "inherit";
	return value ? "required" : "none";
}

function ndaOverrideFrom(value: string): boolean | null {
	if (value === "required") return true;
	if (value === "none") return false;
	return null;
}
// #endregion

// #region Stage list
/**
 * One stage row: a drag handle, a disclosure, and the stage's own configuration.
 *
 * The outstanding requirements read as inline middot-separated text rather than as chips. A chip is a
 * promise of interactivity (§B.11) and "Needs pricing" cannot be pressed; the way to act on it is the
 * field two lines below, which the disclosure already opens.
 */
function StageRow(props: {
	stage: StageSetup;
	index: number;
	itemLabel: string;
	session: boolean;
	currency: string;
	projectRequiresNda: boolean;
	open: boolean;
	onToggle: () => void;
	onPatch: (patch: Partial<StageSetup>) => void;
	onRemove: () => void;
}): JSX.Element {
	const { stage, currency } = props;
	const sortable = useSortable({
		id: `stage:${stage.id}`,
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: props.itemLabel,
	});
	const scoped = stage.description.trim().length > 0;
	const priced = stage.unitPriceCents !== null;
	const outstanding = [!scoped && "Needs scope", !priced && "Needs pricing"].filter(Boolean);
	const fieldId = (part: string) => `psu-stage-${stage.id}-${part}`;
	const nameKey = `stage:${stage.id}:name`;
	const exponent = currencyExponent(currency);

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
					aria-label={`Reorder ${stage.name || props.itemLabel}`}
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
					<span class="psu-stage__name">{stage.name || `Untitled ${props.itemLabel}`}</span>
					{outstanding.length > 0 && (
						<span class="psu-stage__outstanding">{outstanding.join(" · ")}</span>
					)}
					<span class="psu-stage__chev" aria-hidden="true">
						<Icon name={props.open ? "chevron-up" : "chevron-down"} />
					</span>
				</button>

				<button
					type="button"
					class="psu-stage__remove"
					aria-label={`Remove ${stage.name || props.itemLabel}`}
					onClick={props.onRemove}
				>
					<Icon name="trash" />
				</button>
			</div>

			{props.open && (
				<div class="psu-stage__body">
					<Field label="Name" htmlFor={fieldId("name")} fieldKey={nameKey}>
						<InputText
							id={fieldId("name")}
							value={stage.name}
							onValueChange={(name: string) => props.onPatch({ name })}
							block
							maxLength={120}
							placeholder="e.g. Discovery"
							status={fieldStatus(nameKey, stage.name.trim() ? "default" : "required")}
						/>
					</Field>

					<Field label="Scope">
						<RichTextEditor
							key={stage.id}
							value={stage.description}
							onValueChange={(description: string) => props.onPatch({ description })}
							placeholder="Deliverables, acceptance criteria, delivery notes…"
							status={scoped ? "default" : "gate"}
							minRows={3}
							aria-label={`Scope for ${stage.name || props.itemLabel}`}
						/>
					</Field>

					<div class="psu-row">
						<Field
							label={props.session ? "Duration" : "Delivery"}
							htmlFor={fieldId("milestone")}
						>
							<InputText
								id={fieldId("milestone")}
								value={stage.milestone}
								onValueChange={(milestone: string) => props.onPatch({ milestone })}
								block
								maxLength={240}
								placeholder={props.session ? "e.g. 60 minutes" : "e.g. 2 weeks"}
							/>
						</Field>

						<Field
							label={props.session ? "Session price" : "Ticket price"}
							htmlFor={fieldId("price")}
						>
							<InputNumber
								id={fieldId("price")}
								value={toMajor(stage.unitPriceCents, currency)}
								onValueChange={(v: number | null) =>
									props.onPatch({ unitPriceCents: toMinorUnits(v, currency) })}
								mode="currency"
								currency={currency}
								maxFractionDigits={exponent}
								minFractionDigits={exponent}
								min={0}
								placeholder="Unpriced"
								status={priced ? "default" : "gate"}
							/>
						</Field>
					</div>

					<div class="psu-row">
						<Field
							label="Working days"
							htmlFor={fieldId("duration")}
							hint="Leave empty for open-ended."
						>
							<InputNumber
								id={fieldId("duration")}
								value={stage.durationDays}
								onValueChange={(v: number | null) =>
									props.onPatch({
										durationDays: v === null || !Number.isFinite(v)
											? null
											: Math.max(1, Math.min(3650, Math.round(v))),
									})}
								min={1}
								max={3650}
								showButtons
								placeholder="Open-ended"
							/>
						</Field>

						<Field label="Starts">
							<Select
								options={DEPENDENCY_OPTIONS}
								value={stage.dependency}
								onValueChange={(v: string) => props.onPatch({ dependency: v as StageDependency })}
								aria-label={`When ${stage.name || props.itemLabel} starts`}
							/>
						</Field>
					</div>

					<div class="psu-row">
						<Field label="Capacity">
							<SelectButton
								options={CAPACITY_OPTIONS}
								value={stage.capacity}
								onValueChange={(v: string | string[]) =>
									props.onPatch(normaliseSeats(v as StageCapacity, stage.seatCount))}
								aria-label="Capacity"
							/>
						</Field>

						{stage.capacity === "limited" && (
							<Field label="Seats" htmlFor={fieldId("seats")}>
								<InputNumber
									id={fieldId("seats")}
									value={stage.seatCount}
									onValueChange={(v: number | null) =>
										props.onPatch(
											normaliseSeats(
												"limited",
												v === null ? null : Math.max(1, Math.min(99, Math.round(v))),
											),
										)}
									min={1}
									max={99}
									showButtons
								/>
							</Field>
						)}
					</div>

					{!props.session && (
						<Field
							label="Required skills"
							hint="Up to ten. A stage asking for twenty is asking for nobody."
						>
							<Chips
								value={stage.skills}
								onValueChange={(skills: string[]) => props.onPatch({ skills })}
								placeholder="Add a skill…"
								max={10}
								addOnBlur
								aria-label={`Required skills for ${stage.name || props.itemLabel}`}
							/>
						</Field>
					)}

					<TaskList stage={stage} itemLabel={props.itemLabel} onPatch={props.onPatch} />

					<StageRoleList stage={stage} currency={currency} onPatch={props.onPatch} />

					<div class="psu-row">
						<Field
							label="Accepted deliverables"
							hint="Leave empty to accept any file."
						>
							<MultiSelect
								options={FILE_KIND_OPTIONS}
								value={stage.allowedFileKinds}
								onValueChange={(allowedFileKinds: string[]) => props.onPatch({ allowedFileKinds })}
								placeholder="Any file"
								showClear
								aria-label={`Accepted deliverables for ${stage.name || props.itemLabel}`}
							/>
						</Field>

						<Field label="NDA">
							<Select
								options={ndaOverrideOptions(props.projectRequiresNda)}
								value={ndaOverrideValue(stage.ndaRequired)}
								onValueChange={(v: string) => props.onPatch({ ndaRequired: ndaOverrideFrom(v) })}
								aria-label={`NDA for ${stage.name || props.itemLabel}`}
							/>
						</Field>
					</div>
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
	const session = setup.format === "session";
	const staged = hasStages(setup.structure);

	const add = () => {
		const id = newStageId();
		const ordinal = setup.stages.length + 1;
		const name = `${itemLabel[0].toUpperCase()}${itemLabel.slice(1)} ${ordinal}`;
		patchSetup({ stages: [...setup.stages, blankStage(id, name, setup.stages.length)] });
		open.value = id;
	};

	const patchRow = (id: string, patch: Partial<StageSetup>) => {
		patchSetup({ stages: setup.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
	};

	const remove = (id: string) => {
		patchSetup({ stages: setup.stages.filter((s) => s.id !== id) });
		if (open.value === id) open.value = null;
	};

	const reorder = (activeId: string | null, overId: string | null) => {
		if (!activeId || !overId || activeId === overId) return;
		const strip = (id: string) => id.replace("stage:", "");
		const from = setup.stages.findIndex((s) => s.id === strip(activeId));
		const to = setup.stages.findIndex((s) => s.id === strip(overId));
		if (from === -1 || to === -1) return;
		patchSetup({
			stages: arrayMove(setup.stages, from, to).map((s, order) => ({ ...s, order })),
		});
	};

	const label = staffingSectionLabel(setup);

	return (
		<Section sectionKey="stages" title={label} hint={hint}>
			{
				/*
				 * The toggle drives the EXISTING `structure` axis rather than a boolean of its own.
				 * `projects.structure_variation` already carries `single_stage` for exactly this, and a
				 * parallel flag would be a second answer to one question — the pair would eventually
				 * disagree and nothing would say which one the board should believe.
				 */
			}
			<Field
				label={`Break this into ${itemLabel}s`}
				hint={staged
					? `Each ${itemLabel} is priced, scoped and staffed on its own.`
					: "The project's own scope and price are the whole unit of work."}
			>
				<ToggleSwitch
					value={staged}
					onValueChange={(on: boolean) =>
						patchSetup({ structure: structureForStages(on, setup.format) })}
					label={`Use ${itemLabel}s`}
				/>
			</Field>

			{staged && (
				<>
					<DndContext onDragEnd={(e) => reorder(e.active.id, e.canceled ? null : e.over)}>
						<ul class="psu-list" aria-label={label}>
							{setup.stages.map((stage, index) => (
								<StageRow
									key={stage.id}
									stage={stage}
									index={index}
									itemLabel={itemLabel}
									session={session}
									currency={setup.budget.currency}
									projectRequiresNda={setup.rules.ndaRequired}
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
				</>
			)}
		</Section>
	);
}
// #endregion

// #region Role list
/** The staffing roles a Direct Deliverable takes instead of a stage run. */
export function RoleListSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const currency = setup.budget.currency;
	const exponent = currencyExponent(currency);

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
		<Section sectionKey="roles" title={ROLE_SECTION_LABEL} hint={hint}>
			<ul class="psu-list" aria-label={ROLE_SECTION_LABEL}>
				{setup.roles.map((role) => {
					const nameKey = `role:${role.id}:name`;
					return (
						<li key={role.id} class="psu-role">
							<div class="psu-role__head">
								<Field label="Role name" htmlFor={`psu-role-${role.id}-name`} fieldKey={nameKey}>
									<InputText
										id={`psu-role-${role.id}-name`}
										value={role.name}
										onValueChange={(name: string) => patchRow(role.id, { name })}
										block
										maxLength={120}
										placeholder="e.g. Lead designer"
										status={fieldStatus(nameKey, role.name.trim() ? "default" : "required")}
									/>
								</Field>
								<button
									type="button"
									class="psu-stage__remove"
									aria-label={`Remove ${role.name || "role"}`}
									onClick={() => remove(role.id)}
								>
									<Icon name="trash" />
								</button>
							</div>

							<div class="psu-row">
								<Field label="Skills">
									<Chips
										value={role.skills}
										onValueChange={(skills: string[]) => patchRow(role.id, { skills })}
										placeholder="Add a skill…"
										max={20}
										addOnBlur
										aria-label={`Skills for ${role.name || "role"}`}
									/>
								</Field>
								<Field label="Role budget" htmlFor={`psu-role-${role.id}-budget`}>
									<InputNumber
										id={`psu-role-${role.id}-budget`}
										value={toMajor(role.budgetCents, currency)}
										onValueChange={(v: number | null) =>
											patchRow(role.id, { budgetCents: toMinorUnits(v, currency) })}
										mode="currency"
										currency={currency}
										maxFractionDigits={exponent}
										minFractionDigits={exponent}
										min={0}
										placeholder="Unpriced"
										status={role.budgetCents === null ? "gate" : "default"}
									/>
								</Field>
							</div>
						</li>
					);
				})}
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

// #region Attachments & NDA
const ATTACHMENT_PICKER = "psu-attachments";
const NDA_PICKER = "psu-nda";

/** The library an upload is filed in, resolved from the session on first use. */
async function actingOwnerId(): Promise<string | null> {
	const me = await AccountService.current();
	return me?.userId ?? null;
}

/**
 * Reference files, and the NDA the engagement is offered under.
 *
 * An attachment is carried by `files.items` REFERENCE, never by URL, so the same asset can be a
 * project brief here and a submission deliverable elsewhere without the bytes having two lifetimes.
 * That is why both paths — picking from the library and uploading from the device — end in an asset
 * id: the upload is a way of getting a file INTO the library, not a second kind of attachment.
 */
export function AttachmentsSection({ setup }: { setup: ProjectSetup }): JSX.Element {
	const busy = useSignal(false);
	const failure = useSignal<string | null>(null);
	const rules = setup.rules;
	const room = MAX_PROJECT_ATTACHMENTS - setup.attachments.length;

	const addAttachments = (items: ProjectAttachment[]) => {
		if (items.length === 0) return;
		const held = new Set(setup.attachments.map((a) => a.id));
		const fresh = items.filter((a) => !held.has(a.id));
		if (fresh.length === 0) return;
		patchSetup({
			attachments: [...setup.attachments, ...fresh].slice(0, MAX_PROJECT_ATTACHMENTS),
		});
	};

	const fromLibrary = (assets: AssetItem[]) => {
		addAttachments(
			assets.map((a) => ({ id: a.id, name: a.name, sizeBytes: a.sizeBytes ?? null })),
		);
	};

	/**
	 * Upload device files into the owner's library, then attach what landed.
	 *
	 * A partial success is kept rather than refused: three of four references arriving is still three
	 * useful references, and the one that failed is named so it can be retried. That is the opposite
	 * of the chat composer's rule, and deliberately — a message is a statement about the things
	 * attached to it, where a reference pack is a pack.
	 */
	const fromDevice = async (files: File[]) => {
		if (files.length === 0 || busy.value) return;
		busy.value = true;
		failure.value = null;
		try {
			const ownerId = await actingOwnerId();
			if (!ownerId) {
				failure.value =
					"We could not tell whose library to file these in — sign in again and retry.";
				return;
			}
			const sent = files.slice(0, Math.max(0, room));
			const outcome = await uploadForProject(sent, {
				ownerType: "user",
				ownerId,
				metadataFor: extractMetadata,
			});

			// `assetIds` keeps the caller's ORDER but drops the files that did not land, so it cannot be
			// zipped against `sent` by index: one failure at position 0 would name every asset after it
			// with the file before it. The failed positions are removed from `sent` first, which leaves
			// two lists that are the same length and in the same order by construction.
			const failedAt = new Set(outcome.failures.map((f) => f.index));
			const kept = sent.filter((_, i) => !failedAt.has(i));
			addAttachments(
				outcome.assetIds.map((id, i) => ({
					id,
					name: kept[i]?.name ?? id,
					sizeBytes: kept[i]?.size ?? null,
				})),
			);

			if (outcome.failures.length > 0) {
				failure.value = `${
					outcome.failures.map((f) => f.name).join(", ")
				} could not be uploaded. Everything else was attached.`;
			}
		} finally {
			busy.value = false;
		}
	};

	const onFileInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
		const picked = event.currentTarget.files;
		if (picked) void fromDevice(Array.from(picked));
		event.currentTarget.value = "";
	};

	return (
		<Section sectionKey="attachments" title="Attachments & NDA">
			<Field
				label="Reference files"
				hint={`Briefs, brand sheets, specs. Up to ${MAX_PROJECT_ATTACHMENTS}.`}
			>
				<ul class="psu-rows" role="list">
					{setup.attachments.map((file) => (
						<li key={file.id} class="psu-file">
							<Icon class="psu-file__glyph" name="attachment" size="sm" />
							<span class="psu-file__name">{file.name}</span>
							{file.sizeBytes !== null && (
								<span class="psu-file__meta">{formatBytes(file.sizeBytes)}</span>
							)}
							<button
								type="button"
								class="psu-stage__remove"
								aria-label={`Remove ${file.name}`}
								onClick={() =>
									patchSetup({
										attachments: setup.attachments.filter((a) => a.id !== file.id),
									})}
							>
								<Icon name="trash" />
							</button>
						</li>
					))}
					{setup.attachments.length === 0 && <li class="psu-list__empty">Nothing attached yet.</li>}
				</ul>

				<div class="psu-actions">
					<button
						type="button"
						class="psu-add psu-add--sm"
						disabled={room <= 0 || busy.value}
						onClick={() =>
							openPicker({
								requesterId: ATTACHMENT_PICKER,
								title: "Attach from your files",
								multiple: true,
								max: Math.max(1, room),
							})}
					>
						<Icon name="attachment" />
						Add from your files
					</button>

					<label class="psu-add psu-add--sm" data-disabled={room <= 0 || busy.value || undefined}>
						<Icon name="upload" />
						{busy.value ? "Uploading…" : "Upload"}
						<input
							type="file"
							class="psu-visually-hidden"
							multiple
							disabled={room <= 0 || busy.value}
							onChange={onFileInput}
						/>
					</label>
				</div>

				{failure.value && <Note>{failure.value}</Note>}
				{room <= 0 && <Note>That is the limit — remove one to attach another.</Note>}
			</Field>

			<div class="psu-toggles">
				<Checkbox
					value={rules.ndaRequired}
					onValueChange={(ndaRequired: boolean) => patchSetup({ rules: { ndaRequired } })}
					label="Require an NDA before work begins"
				/>
			</div>

			{rules.ndaRequired && (
				<>
					<Field
						label="Which NDA"
						hint="The platform's standard mutual NDA needs no upload and no legal review."
					>
						<SelectButton
							options={[
								{ value: "platform", label: "Projective standard" },
								{ value: "custom", label: "Your own document" },
							]}
							value={rules.ndaSource}
							onValueChange={(v: string | string[]) =>
								patchSetup({
									rules: {
										ndaSource: v as NdaDocumentSource,
										// Dropping the reference when the source goes back to the platform standard:
										// leaving it behind would keep a document id nothing points at, which reads
										// on the next open as a custom NDA that is not in force.
										ndaDocumentId: v === "custom" ? rules.ndaDocumentId : null,
									},
								})}
							aria-label="Which NDA"
						/>
					</Field>

					{rules.ndaSource === "custom" && (
						<Field
							label="NDA document"
							hint="Freelancers sign this before they can see the stage they are applying to."
						>
							{rules.ndaDocumentId
								? (
									<div class="psu-file">
										<Icon class="psu-file__glyph" name="document" size="sm" />
										<span class="psu-file__name">{rules.ndaDocumentId}</span>
										<button
											type="button"
											class="psu-stage__remove"
											aria-label="Remove the NDA document"
											onClick={() => patchSetup({ rules: { ndaDocumentId: null } })}
										>
											<Icon name="trash" />
										</button>
									</div>
								)
								: (
									<>
										<button
											type="button"
											class="psu-add psu-add--sm"
											onClick={() =>
												openPicker({
													requesterId: NDA_PICKER,
													title: "Choose your NDA",
													kinds: ["pdf", "doc"],
													multiple: false,
												})}
										>
											<Icon name="document" />
											Choose a document
										</button>
										<Note>
											You have chosen your own NDA and not attached it yet — the engagement cannot
											be published until you do.
										</Note>
									</>
								)}
						</Field>
					)}
				</>
			)}

			<AssetPicker requesterId={ATTACHMENT_PICKER} onPick={fromLibrary} />
			<AssetPicker
				requesterId={NDA_PICKER}
				onPick={(assets: AssetItem[]) => {
					const doc = assets[0];
					if (doc) patchSetup({ rules: { ndaDocumentId: doc.id } });
				}}
			/>
		</Section>
	);
}
// #endregion

// #region Terms & visibility
/**
 * The terms the engagement is offered under — every one of them a term a freelancer agrees to.
 *
 * Visibility governs TWO facts that a single dropdown would conflate, so the control is scoped to
 * one of them and the note carries the other — and each reads its own field rather than inferring
 * the second from the first. `rules.visibility` is the intent ON PUBLISH, stored on its own column;
 * `setup.liveVisibility` is where the row sits today, derived server-side from the status.
 *
 * Scoping it this way is what keeps the label honest. A dropdown labelled plain "Visibility" showing
 * `public` over a row that is unlisted would be stating something false; the same dropdown showing
 * `unlisted` would hide the decision the owner actually needs to make before publishing. Naming the
 * control for the moment it takes effect lets it show a real stored value and still answer the
 * question the owner is actually asking.
 *
 * The note reads `liveVisibility` rather than re-deriving "draft implies unlisted" from the status.
 * The two agree on every row this surface writes — the update path converges them on every save —
 * but a second derivation here could disagree with the server's on a row written before the intent
 * column existed, and the failure mode of that disagreement is telling an owner their project is
 * hidden while it is on Explore.
 */
export function RulesSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const rules = setup.rules;
	const isDraft = setup.status === "draft";
	const hidden = setup.liveVisibility !== "public";
	const deferred = isDraft || setup.liveVisibility !== rules.visibility;

	return (
		<Section sectionKey="rules" title="Terms & visibility" hint={hint}>
			<div class="psu-row">
				<Field
					label="Visibility on publish"
					hint={deferred
						? "This is what applies the moment you publish."
						: "Live now — changes here take effect immediately."}
				>
					<Select
						options={optionsOf(VISIBILITY_LABEL)}
						value={rules.visibility}
						onValueChange={(v: string) =>
							patchSetup({ rules: { visibility: v as ProjectVisibility } })}
						aria-label="Visibility on publish"
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

			{deferred && (
				<Note>
					{hidden
						? `Right now this project is ${
							VISIBILITY_LABEL[setup.liveVisibility].toLowerCase()
						}, so nothing half-written reaches Explore.`
						: "Right now this project is public."} {isDraft
						? "It stays that way until you publish it."
						: "The setting above applies once its status changes."}
				</Note>
			)}

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
				<Field label="Locations" hint="Leave empty to accept freelancers anywhere.">
					<MultiSelect
						options={LOCATION_OPTIONS}
						value={rules.locationRestriction}
						onValueChange={(locationRestriction: string[]) =>
							patchSetup({ rules: { locationRestriction } })}
						placeholder="Anywhere"
						filter
						grouping
						showClear
						aria-label="Locations"
					/>
				</Field>
				<Field label="Languages" hint="Leave empty to accept any language.">
					<MultiSelect
						options={LANGUAGE_OPTIONS}
						value={rules.languageRequirement}
						onValueChange={(languageRequirement: string[]) =>
							patchSetup({ rules: { languageRequirement } })}
						placeholder="Any language"
						filter
						showClear
						aria-label="Languages"
					/>
				</Field>
			</div>

			{
				/*
				 * A deadline bonus is paid per TICKET, and only a pipeline has tickets. On every other
				 * format the control is ABSENT rather than disabled: absence is for a capability that does
				 * not exist here, and a greyed switch would advertise one that does.
				 */
			}
			{setup.format === "pipeline" && (
				<div class="psu-toggles">
					<ToggleSwitch
						value={rules.allowDeadlineBonuses}
						onValueChange={(allowDeadlineBonuses: boolean) =>
							patchSetup({ rules: { allowDeadlineBonuses } })}
						label="Allow deadline bonuses on tickets"
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
		case "attachments":
			return <AttachmentsSection setup={setup} />;
		case "rules":
			return <RulesSection setup={setup} hint={hintFor(setup, "rules")} />;
	}
	return null;
}
// #endregion
