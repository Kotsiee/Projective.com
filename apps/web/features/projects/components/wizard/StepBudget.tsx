import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	Button,
	Chips,
	FormControl,
	InputNumber,
	InputText,
	type Option,
	SelectButton,
} from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import {
	addRole,
	patchDraft,
	patchRole,
	patchStage,
	removeRole,
	wizardDraft,
	type WizardRole,
	type WizardStage,
} from "../../core/wizard-state.ts";
import { DEFAULT_STAGE_SETUP } from "../../types/projects-types.ts";
import { WizardField, WizardGroup, WizardNote, WizardRow } from "./WizardField.tsx";
import { WizardBlock } from "./WizardBlock.tsx";
import { StageWorkbench } from "./StageWorkbench.tsx";
import { BUDGET_TYPE_OPTIONS, priceLabel, stageNoun, stageNounPlural } from "./wizard-vocab.ts";

/**
 * Step 5 — Budget & Staffing (the "how much"). What the work costs, and how many people may take it
 * on.
 *
 * **The client never totals anything.** It converts the units a person types into the minor units
 * the schema carries and sends them; every sum, fee, split and conversion is the server's. There is
 * no arithmetic on this screen beyond `major × 100`.
 *
 * The project budget is rendered on BOTH shapes and always, because it is the answer the readiness
 * ladder's pricing row actually reads: an engagement that declares no stages has nowhere else to
 * state a price, and one that does can still be priced as a whole. A `null` amount is "not priced
 * yet", which is a different fact from zero and is stored as one.
 */

// #region Units
/** Minor units from what a person typed. Never a total — a units transform on one figure. */
function toMinor(major: number | null): number | null {
	if (major === null || !Number.isFinite(major)) return null;
	return Math.max(0, Math.round(major * 100));
}

/** The typed figure back from minor units, for the control to display. */
function toMajor(minor: number | null): number | null {
	return minor === null ? null : minor / 100;
}

/** Seats are a headcount or they are uncapped; there is no third answer. */
const SEAT_MODE_OPTIONS: Option[] = [
	{ value: "limited", label: "Limited" },
	{ value: "unlimited", label: "Unlimited" },
];

/** How the engagement as a whole is priced — the `finance.budget_type` vocabulary. */
type BudgetKind = "fixed_price" | "hourly_cap";
// #endregion

// #region The stage inspector
interface StageMoneyProps {
	stage: WizardStage;
	noun: string;
	currency: string;
	label: string;
}

/**
 * What one stage costs and how many people may hold it.
 *
 * The price is `unit_price_cents` for both shapes, deliberately: a pipeline reads it as the
 * per-ticket rate and a one-off as the whole fixed fee, because a one-off stage is a one-ticket
 * stage. A second price field would give "what does this stage cost" two answers while
 * `finance.fn_hold_ticket_escrow` reads only one of them.
 *
 * `seatLimit` is nullable-as-unlimited, following `finance.plan_entitlements`' own convention. It is
 * headcount and nothing else — not summed workload, not a role's establishment.
 */
function StageMoney({ stage, noun, currency, label }: StageMoneyProps): JSX.Element {
	const patch = (next: Partial<WizardStage>) => patchStage(stage.key, next);
	const seatMode = stage.seatLimit === null ? "unlimited" : "limited";

	return (
		<>
			<WizardField
				field="stageUnitPrice"
				stageKey={stage.key}
				label={label}
				hint={`What one ticket against ${stage.name || `this ${noun}`} is worth.`}
			>
				{({ id, describedBy, status }) => (
					<InputNumber
						id={id}
						aria-describedby={describedBy}
						value={toMajor(stage.unitPriceCents)}
						onValueChange={(next: number | null) => patch({ unitPriceCents: toMinor(next) })}
						mode="currency"
						currency={currency}
						min={0}
						placeholder="Unpriced"
						status={status}
						fluid
					/>
				)}
			</WizardField>

			<WizardRow>
				<WizardField
					field="stageSeatLimit"
					stageKey={stage.key}
					label="Seats"
					required={false}
					hint="How many freelancers may hold this stage at once."
				>
					{({ id, describedBy, status }) => (
						<SelectButton
							id={id}
							aria-describedby={describedBy}
							options={SEAT_MODE_OPTIONS}
							value={seatMode}
							onValueChange={(next: string | string[]) =>
								patch({
									seatLimit: next === "unlimited" ? null : DEFAULT_STAGE_SETUP.seatLimit,
								})}
							status={status}
							aria-label={`Seats on ${stage.name || noun}`}
						/>
					)}
				</WizardField>

				{stage.seatLimit !== null && (
					<div class="pwz-field">
						<FormControl label="How many">
							{({ id, describedBy }) => (
								<InputNumber
									id={id}
									aria-describedby={describedBy}
									value={stage.seatLimit}
									onValueChange={(next: number | null) =>
										patch({ seatLimit: next === null ? null : Math.max(1, Math.round(next)) })}
									min={1}
									placeholder="3"
									fluid
								/>
							)}
						</FormControl>
					</div>
				)}
			</WizardRow>
		</>
	);
}
// #endregion

// #region Roles
/** One named seat on a stage-less engagement, with the skills it asks for. */
function RoleRow({ role, index }: { role: WizardRole; index: number }): JSX.Element {
	return (
		<li class="pwz-role">
			<div class="pwz-role__head">
				<span class="pwz-role__index" aria-hidden="true">{index + 1}</span>
				<InputText
					value={role.name}
					onValueChange={(name: string) => patchRole(role.key, { name })}
					placeholder="e.g. Lead designer"
					maxLength={120}
					aria-label={`Role ${index + 1} name`}
					block
				/>
				<button
					type="button"
					class="pwz-role__remove"
					aria-label={`Remove ${role.name || `role ${index + 1}`}`}
					onClick={() => removeRole(role.key)}
				>
					<Icon name="trash" size="sm" />
				</button>
			</div>
			<Chips
				value={role.skills}
				onValueChange={(skills: string[]) => patchRole(role.key, { skills })}
				placeholder="Add a skill…"
				max={20}
				addOnBlur
				fluid
				aria-label={`Skills for ${role.name || `role ${index + 1}`}`}
			/>
		</li>
	);
}
// #endregion

// #region The step
export function StepBudget(): JSX.Element {
	const draft = wizardDraft.value;
	const noun = stageNoun(draft.format);
	const label = priceLabel(draft.format);
	// `CreateProjectBudgetSchema` has no nullable amount, so an unpriced engagement carries NO budget
	// object at all — and the pricing MODEL would then have nowhere to live until a figure exists,
	// leaving a segmented control that quietly discarded the author's answer. It is held here until
	// there is a budget to carry it, and it does something visible the whole time: it names the field
	// beside it.
	const budgetType = useSignal<BudgetKind>(draft.budget?.budgetType ?? "fixed_price");

	const writeBudget = (amountCents: number | null) => {
		patchDraft({
			budget: amountCents === null ? null : {
				budgetType: budgetType.value,
				amountCents,
				currency: draft.currency,
			},
		});
	};

	const chooseType = (next: BudgetKind) => {
		budgetType.value = next;
		const amount = draft.budget?.amountCents ?? null;
		if (amount !== null) writeBudget(amount);
	};

	return (
		<>
			<WizardGroup
				title="Project budget"
				hint="What the whole engagement is worth. Leave it unset to price the work piece by piece instead."
			>
				<WizardRow>
					<div class="pwz-field">
						<FormControl label="Priced as">
							{({ id, describedBy }) => (
								<SelectButton
									id={id}
									aria-describedby={describedBy}
									options={BUDGET_TYPE_OPTIONS}
									value={budgetType.value}
									onValueChange={(next: string | string[]) => chooseType(next as BudgetKind)}
									aria-label="Priced as"
								/>
							)}
						</FormControl>
					</div>

					<div class="pwz-field">
						<FormControl
							label={budgetType.value === "hourly_cap" ? "Hourly cap" : "Total budget"}
							hint="Left empty this reads as “not priced yet”, which is not the same as zero."
						>
							{({ id, describedBy }) => (
								<InputNumber
									id={id}
									aria-describedby={describedBy}
									value={toMajor(draft.budget?.amountCents ?? null)}
									onValueChange={(next: number | null) => writeBudget(toMinor(next))}
									mode="currency"
									currency={draft.currency}
									min={0}
									placeholder="Not set"
									fluid
								/>
							)}
						</FormControl>
					</div>
				</WizardRow>
			</WizardGroup>

			{draft.hasStages
				? (
					<WizardGroup
						title={`What each ${noun} costs`}
						hint={draft.format === "pipeline"
							? "The per-ticket rate a freelancer claims against."
							: "The fee released when the milestone is accepted."}
					>
						<StageWorkbench
							title={stageNounPlural(draft.format)}
							empty={`Nothing to price yet — add a ${noun} on step 3, or price the project as a whole above.`}
							summary={(stage) => stage.unitPriceCents === null ? null : "priced"}
							inspector={(stage) => (
								<StageMoney
									key={stage.key}
									stage={stage}
									noun={noun}
									currency={draft.currency}
									label={label}
								/>
							)}
						/>
					</WizardGroup>
				)
				: (
					<WizardGroup
						title="Team roles"
						hint="A single-delivery engagement is staffed by named roles rather than by stages."
					>
						<WizardBlock
							field="roles"
							label="Roles"
							hint="Each one is a seat a freelancer can be hired into."
						>
							<ul class="pwz-roles">
								{draft.roles.map((role, index) => (
									<RoleRow key={role.key} role={role} index={index} />
								))}
								{draft.roles.length === 0 && (
									<li class="pwz-roles__empty">
										No roles yet — add the first one to say who you are hiring.
									</li>
								)}
							</ul>
							<Button
								variant="text"
								severity="primary"
								size="sm"
								label="Add role"
								icon={<Icon name="plus" size="sm" />}
								onClick={addRole}
							/>
						</WizardBlock>
					</WizardGroup>
				)}

			{draft.hasStages && draft.stages.length === 0 && (
				<WizardNote>
					No {noun}s are declared, so the project is created with a single delivery {noun}{" "}
					carrying the whole budget above.
				</WizardNote>
			)}
		</>
	);
}
// #endregion
