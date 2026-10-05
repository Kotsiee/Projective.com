import type { JSX } from "preact";
import {
	Chips,
	DatePicker,
	type DateValue,
	InputText,
	MultiSelect,
	NumberInput,
	type Option,
	Select,
	SelectButton,
	useFieldValidation,
} from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { currencyExponent, toMinorUnits } from "@projective/types/finance";
import {
	MAX_STAGE_SKILLS,
	normaliseSeats,
	STAGE_DELAY_MAX_DAYS,
	STAGE_PRICE_LOCK_REASON,
} from "../../types/projects-types.ts";
import type { StageCapacity, StageDependency, StageSetup } from "../../types/projects-types.ts";
import { setupReveal } from "../../core/setup-state.ts";
import { fieldStatus } from "../../core/setup-validation.ts";
import { Disclosure, Field, FieldGroup, PairRow } from "./setup-primitives.tsx";
import {
	CAPACITY_OPTIONS,
	clampDelay,
	COUNT_FIELD,
	DEPENDENCY_OPTIONS,
	FILE_KIND_OPTIONS,
	fromIsoDate,
	minorUnit,
	MONEY_FIELD,
	toIsoDate,
	toMajor,
} from "./setup-format.ts";
import {
	ndaOverrideFrom,
	ndaOverrideOptions,
	ndaOverrideValue,
	StageRoleList,
	TaskList,
} from "./SetupStageEditors.tsx";

/**
 * SetupStageFields — everything one stage is, as controls: the single form body the staged accordion
 * on the project surface and the standalone Stage Details tab both render.
 */

// #region Stage fields
/**
 * Props for {@link StageFields}.
 *
 * Everything here is resolved by the CALLER, and the two that look like they could be resolved
 * locally are the reason. `predecessorOptions` and `priceLocked` are both answers about the whole
 * stage LIST — which stages this one may legally wait for, and which stages a hired freelancer has
 * frozen the price of — so a component that asked for them itself would need the project it is a
 * part of and would rebuild an identical answer once per stage in the accordion.
 */
export interface StageFieldsProps {
	/** The stage being configured. */
	stage: StageSetup;
	/**
	 * Its 0-based position in the run.
	 *
	 * Load-bearing rather than cosmetic: the predecessor + lag pair is asked only of a sequential
	 * stage that is not the FIRST, because the first has nothing above it to wait for. Rendering
	 * those controls at position 0 would be a live affordance whose value the board never reads
	 * (root CLAUDE.md §3 gate 11).
	 */
	index: number;
	/** What one of these is called in this engagement's vocabulary — stage · milestone · session. */
	itemLabel: string;
	/** Whether the engagement is a session — it changes what two of these fields are asking for. */
	session: boolean;
	/** Whether the engagement is a one-off — only a milestone is asked for a delivery DATE. */
	oneOff: boolean;
	/** The stages this one may legally wait for: never itself, never one whose chain leads back here. */
	predecessorOptions: Option[];
	/** The engagement's currency, for the price field's exponent and its symbol. */
	currency: string;
	/** Whether the PROJECT requires an NDA — it decides what this stage's override may say. */
	projectRequiresNda: boolean;
	/**
	 * Whether THIS stage's own price is frozen by somebody already working it.
	 *
	 * A boolean rather than the set, and resolved by the caller rather than here: see the note on
	 * {@link StageFieldsProps} above.
	 */
	priceLocked: boolean;
	/**
	 * Whether this engagement has a sequence for the stage to sit in — {@link stageTimingApplies}.
	 *
	 * A boolean resolved by the caller for the same reason `priceLocked` is: the answer is about the
	 * whole stage LIST and the project's structure, neither of which a component rendering one stage
	 * has, and both callers already hold the configuration it is read from.
	 */
	timed: boolean;
	/** Fold an edit into the stage. The caller owns the identity match against the stage list. */
	onPatch: (patch: Partial<StageSetup>) => void;
}

/**
 * StageFields — everything a stage IS, as controls: its name, its scope, what it delivers, its step
 * list, the skills it needs, its price and timing, its capacity and named roles, and the submission
 * and confidentiality rules that apply to it.
 *
 * Extracted from {@link StageRow}'s expanded body so the accordion on `/projects/[projectId]` and
 * the standalone Stage Details tab at `/projects/[projectId]/[channelId]/details` are ONE component
 * tree rather than two forms that happen to agree on the day they were written. What separates the
 * two surfaces is chrome — the card owns the grip, the summary row, the disclosure and the remove
 * button; the tab owns a heading and nothing else — so the fields are the whole of what they share
 * and therefore the whole of what could drift.
 *
 * It renders a FRAGMENT, not a container. `.psu-stage__body` carries a hairline and an inset because
 * it is the open half of an accordion row; on the standalone tab there is no row above it for a
 * hairline to separate from, and drawing one anyway would be a separation device spent on a boundary
 * that does not exist (§B.4). The caller supplies whichever container it needs — the card its
 * `.psu-stage__body`, the tab the `Section` body it is already inside, both of which are the same
 * `flex column` with the same gap.
 *
 * The two field verdicts are HOOKS and live here rather than being passed in. A caller that resolved
 * them would have to restate their sentences, which is exactly the drift the extraction removes. The
 * cost is that a stage collapsed and re-expanded in the accordion starts untouched again, so a gate
 * that had appeared stands down until the field is left once more or Save demands every verdict. The
 * fact itself is never lost: the collapsed row's middot line carries the same two requirements and
 * is visible in both states.
 */
export function StageFields(props: StageFieldsProps): JSX.Element {
	const { stage, currency, itemLabel, session, predecessorOptions } = props;
	const scoped = stage.description.trim().length > 0;
	const priced = stage.unitPriceCents !== null;
	const fieldId = (part: string) => `psu-stage-${stage.id}-${part}`;
	const nameKey = `stage:${stage.id}:name`;
	const exponent = currencyExponent(currency);
	// `gate`, not `invalid`: neither of these is a wrong value, it is an unfinished one. The ramp says
	// "this is what publishing is waiting on" rather than "you have made a mistake", which is what the
	// same two facts already read as in the collapsed row's middot line.
	const scope = useFieldValidation({
		problem: scoped ? null : `Say what this ${itemLabel} delivers.`,
		reveal: setupReveal,
		problemStatus: "gate",
	});
	// A frozen price is not an unfinished one, so the gate stands down rather than accusing a field the
	// owner is forbidden to complete. Unlocked, this is the original verdict unchanged.
	const price = useFieldValidation({
		problem: priced || props.priceLocked ? null : `Give this ${itemLabel} a price.`,
		reveal: setupReveal,
		problemStatus: "gate",
	});
	const priceLabel = session ? "Session price" : itemLabel === "milestone" ? "Fee" : "Ticket price";

	return (
		<>
			<Field label="Name" htmlFor={fieldId("name")} fieldKey={nameKey}>
				<InputText
					id={fieldId("name")}
					aria-describedby={`${fieldId("name")}-problem`}
					value={stage.name}
					onValueChange={(next: string) => props.onPatch({ name: next })}
					block
					maxLength={120}
					placeholder="e.g. Discovery"
					status={fieldStatus(nameKey, stage.name.trim() ? "default" : "required")}
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

			{
				/*
				 * `milestone` sits with Scope rather than with the timing fields, because it is the
				 * OUTCOME half of "what does this stage deliver" — a sentence, not a schedule. The
				 * columns that answer WHEN are below it.
				 */
			}
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

			<TaskList stage={stage} itemLabel={props.itemLabel} onPatch={props.onPatch} />

			{!session && (
				<Field
					label="Required skills"
					hint="Up to ten. A stage asking for twenty is asking for nobody."
				>
					<Chips
						value={stage.skills}
						onValueChange={(skills: string[]) => props.onPatch({ skills })}
						placeholder="Add a skill…"
						max={MAX_STAGE_SKILLS}
						addOnBlur
						aria-label={`Required skills for ${stage.name || props.itemLabel}`}
					/>
				</Field>
			)}

			{
				/*
				 * A delivery DATE belongs to a milestone and to nothing else, so the row is a PAIR on a
				 * one-off and a lone field on a pipeline — never a pair with an empty half. A pipeline
				 * stage's timing is its predecessor plus its lag, and offering a calendar date beside
				 * that would be a second answer to when the stage starts, with nothing to say which one
				 * the board should draw.
				 */
			}
			<PairRow paired={props.oneOff}>
				{
					/*
					 * The lock reason arrives as the `hint`, so it is announced through the control's own
					 * `aria-describedby` and disclosed behind the "?" — never a native `title` (§B.6),
					 * which is unreachable by keyboard and unreadable to a screen reader. This field
					 * carries no hint otherwise, so nothing is displaced to make room for it.
					 */
				}
				<Field
					label={priceLabel}
					htmlFor={fieldId("price")}
					validation={price}
					hint={props.priceLocked ? STAGE_PRICE_LOCK_REASON : undefined}
				>
					<NumberInput
						{...MONEY_FIELD}
						id={fieldId("price")}
						value={toMajor(stage.unitPriceCents, currency)}
						onValueChange={(v: number | null) =>
							props.onPatch({ unitPriceCents: toMinorUnits(v, currency) })}
						currency={currency}
						maxFractionDigits={exponent}
						minFractionDigits={exponent}
						precisionStep={minorUnit(currency)}
						disabled={props.priceLocked}
						status={price.status.value}
					/>
				</Field>

				{props.oneOff && (
					<Field label="Delivery date" hint="Leave empty for no fixed date.">
						<DatePicker
							value={fromIsoDate(stage.deliveryDate)}
							onValueChange={(v: DateValue) => props.onPatch({ deliveryDate: toIsoDate(v) })}
							aria-label={`Delivery date for ${stage.name || props.itemLabel}`}
						/>
					</Field>
				)}
			</PairRow>

			{
				/*
				 * Timing and capacity are two questions, and a row pairing one of each said they were one.
				 * `Starts` sat beside `Capacity` while `Seats` — the field `Capacity` switches on — landed
				 * two rows below it, underneath the predecessor pair, so choosing "Fixed seats" put the
				 * answer somewhere other than beside the control that had just asked for it. Each group
				 * below holds one question's fields and holds them together whatever the toggles do.
				 */
			}
			{props.timed && (
				<FieldGroup id={fieldId("timing-head")} label="Timing & scheduling">
					<Field label="Starts">
						<Select
							options={DEPENDENCY_OPTIONS}
							value={stage.dependency}
							onValueChange={(v: string) => props.onPatch({ dependency: v as StageDependency })}
							aria-label={`When ${stage.name || props.itemLabel} starts`}
						/>
					</Field>

					{
						/*
						 * Predecessor and lag are asked ONLY of a sequential stage that is not the first, and
						 * that is the whole condition. A parallel stage starts with the project, so it waits for
						 * nothing; the first stage has nothing above it to wait for. Rendering either control in
						 * those cases would be a live affordance whose value the board never reads (§3 gate 11).
						 */
					}
					{stage.dependency === "sequential" && props.index > 0 && (
						<div class="psu-row">
							<Field label="Starts with" htmlFor={fieldId("startswith")}>
								<Select
									options={predecessorOptions}
									value={stage.startsWithId ?? ""}
									onValueChange={(v: string) =>
										props.onPatch({ startsWithId: v === "" ? null : v })}
									aria-label={`Which ${props.itemLabel} ${stage.name || props.itemLabel} follows`}
								/>
							</Field>

							<Field
								label="Delay"
								htmlFor={fieldId("delay")}
								hint="Days after it finishes. Negative starts early, overlapping it."
							>
								<NumberInput
									{...COUNT_FIELD}
									icon="clock"
									id={fieldId("delay")}
									value={stage.delayDays}
									onValueChange={(v: number | null) => props.onPatch({ delayDays: clampDelay(v) })}
									min={-STAGE_DELAY_MAX_DAYS}
									max={STAGE_DELAY_MAX_DAYS}
									suffix=" days"
								/>
							</Field>
						</div>
					)}
				</FieldGroup>
			)}

			<FieldGroup id={fieldId("capacity-head")} label="Capacity & resourcing">
				<PairRow paired={stage.capacity === "limited"}>
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
							<NumberInput
								{...COUNT_FIELD}
								icon="members"
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
							/>
						</Field>
					)}
				</PairRow>

				<StageRoleList stage={stage} currency={currency} onPatch={props.onPatch} />
			</FieldGroup>

			<Disclosure label="Advanced settings">
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
			</Disclosure>
		</>
	);
}
// #endregion
