import type { ComponentChildren, JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	Checkbox,
	Chips,
	InputNumber,
	InputText,
	type Option,
	Select,
	SelectButton,
	ToggleSwitch,
} from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { DndContext, useSortable } from "@projective/ui/dnd";
import { Icon } from "@projective/ui/icons";
import {
	ROLE_SECTION_LABEL,
	STAGE_ITEM_LABEL,
	STAGE_SECTION_LABEL,
} from "../../types/projects-types.ts";
import type {
	IpOwnershipMode,
	PortfolioDisplayRights,
	ProjectRoleSetup,
	ProjectSetup,
	ProjectSetupStepKey,
	ProjectVisibility,
	StageSetup,
	TimelinePreset,
} from "../../types/projects-types.ts";
import { patchSetup } from "../../core/setup-state.ts";

/**
 * SetupSections — the owner Details form's section set, and the pure rule that decides which of them
 * an engagement actually gets.
 *
 * The four format branches are one component set with a dispatcher rather than four screens, because
 * the difference between a Pipeline and a Direct Deliverable is WHICH sections apply, not how a
 * section behaves: a stage list relabelled "Milestones" is the same editor, and forking it would give
 * a milestone its own chance to drift away from a stage.
 *
 * Every control is a `@projective/ui/fields` primitive and every edit routes through
 * {@link patchSetup}, so the ladder in the header band re-derives from the same
 * {@link reconcileSetup} the server runs. Nothing here computes a percentage, a total or a gate.
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

const CURRENCY_OPTIONS: Option[] = ["USD", "GBP", "EUR", "AUD", "CAD"].map((c) => ({
	value: c,
	label: c,
}));
// #endregion

// #region Money conversion
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
	children: ComponentChildren;
}): JSX.Element {
	return (
		<div class="psu-field">
			{props.htmlFor
				? <label class="psu-field__label" for={props.htmlFor}>{props.label}</label>
				: <span class="psu-field__label">{props.label}</span>}
			{props.children}
			{props.hint && <p class="psu-field__hint">{props.hint}</p>}
		</div>
	);
}
// #endregion

// #region Basics
/**
 * Identity and shape.
 *
 * Changing the format normalises `structure` and `sessionKind` in the same patch, because those two
 * axes are only meaningful inside one format each: a pipeline has no session kind, and leaving a
 * stale `group` behind would let the ladder and the section set disagree about what is being sold.
 */
export function BasicsSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const setFormat = (next: string | string[]) => {
		const format = next as ProjectSetup["format"];
		if (format === "pipeline") {
			patchSetup({ format, structure: "standard", sessionKind: "none" });
			return;
		}
		if (format === "session") {
			patchSetup({
				format,
				structure: "single_stage",
				sessionKind: setup.sessionKind === "group" ? "group" : "normal",
			});
			return;
		}
		patchSetup({
			format,
			structure: setup.structure === "single_task" ? "single_task" : "one_off",
			sessionKind: "none",
		});
	};

	return (
		<Section title="Basics" hint={hint}>
			<Field label="Project name" htmlFor="psu-title">
				<InputText
					id="psu-title"
					value={setup.title}
					onValueChange={(title: string) => patchSetup({ title })}
					placeholder="Name the engagement"
					block
					maxLength={160}
					status={setup.title.trim() ? "default" : "required"}
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

			{setup.format === "one_off" && (
				<Field
					label="Shape"
					hint="A direct deliverable is staffed by roles rather than run through milestones."
				>
					<SelectButton
						options={SHAPE_OPTIONS}
						value={setup.structure === "single_task" ? "single_task" : "one_off"}
						onValueChange={(v: string | string[]) =>
							patchSetup({ structure: v as ProjectSetup["structure"] })}
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
		<Section title="Description" hint={hint}>
			<RichTextEditor
				key={setup.slug}
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
	const amountLabel = session ? "Rate per session" : "Amount";

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

				<Field label={amountLabel} htmlFor="psu-budget-amount">
					<InputNumber
						id="psu-budget-amount"
						value={toMajor(setup.budget.amountCents)}
						onValueChange={(v: number | null) =>
							patchSetup({ budget: { amountCents: toMinor(v) } })}
						mode="currency"
						currency={setup.budget.currency}
						min={0}
						placeholder="Not set"
						status={setup.budget.amountCents === null ? "gate" : "default"}
					/>
				</Field>

				<Field label="Currency">
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
	open: boolean;
	onToggle: () => void;
	onPatch: (patch: Partial<StageSetup>) => void;
	onRemove: () => void;
}): JSX.Element {
	const { stage } = props;
	const sortable = useSortable({
		id: `stage:${stage.id}`,
		data: { type: "stage", accepts: ["stage"] },
		roleDescription: props.itemLabel,
	});
	const scoped = stage.description.trim().length > 0;
	const priced = stage.unitPriceCents !== null;
	const outstanding = [!scoped && "Needs scope", !priced && "Needs pricing"].filter(Boolean);
	const fieldId = (part: string) => `psu-stage-${stage.id}-${part}`;

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
					<Field label="Name" htmlFor={fieldId("name")}>
						<InputText
							id={fieldId("name")}
							value={stage.name}
							onValueChange={(name: string) => props.onPatch({ name })}
							block
							maxLength={120}
							placeholder="e.g. Discovery"
							status={stage.name.trim() ? "default" : "required"}
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
								value={toMajor(stage.unitPriceCents)}
								onValueChange={(v: number | null) => props.onPatch({ unitPriceCents: toMinor(v) })}
								mode="currency"
								currency={props.currency}
								min={0}
								placeholder="Unpriced"
								status={priced ? "default" : "gate"}
							/>
						</Field>
					</div>

					{!props.session && (
						<Field label="Required skills">
							<Chips
								value={stage.skills}
								onValueChange={(skills: string[]) => props.onPatch({ skills })}
								placeholder="Add a skill…"
								max={20}
								addOnBlur
								aria-label={`Required skills for ${stage.name || props.itemLabel}`}
							/>
						</Field>
					)}
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

	const add = () => {
		const id = newStageId();
		const ordinal = setup.stages.length + 1;
		patchSetup({
			stages: [...setup.stages, {
				id,
				name: `${itemLabel[0].toUpperCase()}${itemLabel.slice(1)} ${ordinal}`,
				order: setup.stages.length,
				description: "",
				unitPriceCents: null,
				milestone: "",
				skills: [],
			}],
		});
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

	return (
		<Section title={staffingSectionLabel(setup)} hint={hint}>
			<DndContext onDragEnd={(e) => reorder(e.active.id, e.canceled ? null : e.over)}>
				<ul class="psu-list" aria-label={staffingSectionLabel(setup)}>
					{setup.stages.map((stage, index) => (
						<StageRow
							key={stage.id}
							stage={stage}
							index={index}
							itemLabel={itemLabel}
							session={session}
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
/** The staffing roles a Direct Deliverable takes instead of a stage run. */
export function RoleListSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
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
					<li key={role.id} class="psu-role">
						<div class="psu-role__head">
							<Field label="Role name" htmlFor={`psu-role-${role.id}-name`}>
								<InputText
									id={`psu-role-${role.id}-name`}
									value={role.name}
									onValueChange={(name: string) => patchRow(role.id, { name })}
									block
									maxLength={120}
									placeholder="e.g. Lead designer"
									status={role.name.trim() ? "default" : "required"}
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
									value={toMajor(role.budgetCents)}
									onValueChange={(v: number | null) =>
										patchRow(role.id, { budgetCents: toMinor(v) })}
									mode="currency"
									currency={setup.budget.currency}
									min={0}
									placeholder="Unpriced"
									status={role.budgetCents === null ? "gate" : "default"}
								/>
							</Field>
						</div>
					</li>
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
/** The terms the engagement is offered under — every one of them a term a freelancer agrees to. */
export function RulesSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const rules = setup.rules;

	return (
		<Section title="Rules" hint={hint}>
			<div class="psu-row">
				<Field label="Visibility">
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

			<div class="psu-toggles">
				<Checkbox
					value={rules.ndaRequired}
					onValueChange={(ndaRequired: boolean) => patchSetup({ rules: { ndaRequired } })}
					label="Require an NDA before work begins"
				/>
				<ToggleSwitch
					value={rules.allowDeadlineBonuses}
					onValueChange={(allowDeadlineBonuses: boolean) =>
						patchSetup({ rules: { allowDeadlineBonuses } })}
					label="Allow deadline bonuses on tickets"
				/>
			</div>
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
