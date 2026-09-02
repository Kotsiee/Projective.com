import type { JSX } from "preact";
import {
	DatePicker,
	type DateValue,
	FormControl,
	InputNumber,
	type Option,
	Select,
	ToggleSwitch,
} from "@projective/ui/fields";
import { patchDraft, patchStage, wizardDraft, type WizardStage } from "../../core/wizard-state.ts";
import { DEADLINE_BONUS_RATE, type StageDurationMode } from "../../types/projects-types.ts";
import { WizardField, WizardGroup, WizardNote, WizardRow } from "./WizardField.tsx";
import { StageWorkbench } from "./StageWorkbench.tsx";
import { DURATION_OPTIONS, stageNoun, stageNounPlural } from "./wizard-vocab.ts";

/**
 * Step 4 — Timeline (the "when"). What waits on what, and when each piece is due.
 *
 * The stage list is rendered READ-ONLY here. Order is the delivery sequence, and the sequence is
 * step 3's answer — a drag on this screen would silently rewrite it from a surface that is about
 * dependencies, and a dependency set two screens ago would change meaning under the author.
 *
 * A dependency is offered only over stages that run BEFORE the one in hand, so the two things that
 * cannot be expressed — waiting on yourself, and waiting on something that has not started — are
 * absent from the control rather than refused after the fact.
 */

// #region Vocabulary
/** The option value standing for "nothing — this starts with the project". */
const NO_DEPENDENCY = "";

/** Days-to-percent, stated once so the sentence and the constant cannot drift. */
const BONUS_PERCENT = Math.round(DEADLINE_BONUS_RATE * 100);

/** The stages one stage may legitimately wait on: every stage above it, and nothing else. */
function dependencyOptions(stages: readonly WizardStage[], index: number, noun: string): Option[] {
	return [
		{ value: NO_DEPENDENCY, label: "The project starting" },
		...stages.slice(0, index).map((stage, position) => ({
			value: stage.key,
			label: `${position + 1}. ${stage.name || `Untitled ${noun}`}`,
		})),
	];
}

/** An ISO instant as the picker's `Date`, refusing an unparseable value rather than throwing. */
function toDate(iso: string | null): Date | null {
	if (!iso) return null;
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** The picker's selection back as an ISO instant; `null` for anything it cannot express. */
function toIsoInstant(value: DateValue): string | null {
	const date = Array.isArray(value) ? value[0] ?? null : value;
	if (!date || Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}
// #endregion

// #region The stage inspector
interface StageWhenProps {
	stage: WizardStage;
	index: number;
	stages: readonly WizardStage[];
	noun: string;
}

/**
 * When one stage runs — what it waits on, whether it runs alongside it, and when it is due.
 *
 * Keyed on the stage's client identity by the caller, and the dependency control is keyed AGAIN on
 * the value it holds: removing a stage clears every dependency that pointed at it, and a `Select`
 * seeded from a raw value would keep showing a stage that no longer exists.
 *
 * Switching the timing model clears the half that no longer applies, so a stage cannot carry both a
 * deadline and a duration and leave the reader guessing which one the server will honour.
 */
function StageWhen({ stage, index, stages, noun }: StageWhenProps): JSX.Element {
	const patch = (next: Partial<WizardStage>) => patchStage(stage.key, next);

	const setDurationMode = (durationMode: StageDurationMode) => {
		patch({
			durationMode,
			durationDays: durationMode === "relative_duration" ? stage.durationDays : null,
			dueDate: durationMode === "fixed_deadline" ? stage.dueDate : null,
		});
	};

	return (
		<>
			{index > 0 && (
				<>
					<WizardField
						field="stageDependsOn"
						stageKey={stage.key}
						label="Waits on"
						required={false}
					>
						{({ id, describedBy, status }) => (
							<Select
								key={`${stage.key}:${stage.dependsOnKey ?? ""}`}
								id={id}
								aria-describedby={describedBy}
								options={dependencyOptions(stages, index, noun)}
								value={stage.dependsOnKey ?? NO_DEPENDENCY}
								onValueChange={(next: string) =>
									patch({ dependsOnKey: next === NO_DEPENDENCY ? null : next })}
								status={status}
								fluid
								aria-label={`What ${stage.name || noun} waits on`}
							/>
						)}
					</WizardField>

					{stage.dependsOnKey !== null && (
						<WizardRow>
							<WizardField
								field="stageParallel"
								stageKey={stage.key}
								label="Runs alongside"
								hint={stage.parallel
									? "Both open together."
									: "This one opens once the other closes."}
							>
								{({ id, describedBy, status }) => (
									<ToggleSwitch
										id={id}
										aria-describedby={describedBy}
										value={stage.parallel}
										onValueChange={(parallel: boolean) => patch({ parallel })}
										status={status}
										aria-label={`${stage.name || noun} runs alongside what it waits on`}
									/>
								)}
							</WizardField>

							<WizardField
								field="stageLagDays"
								stageKey={stage.key}
								label="Wait before opening"
							>
								{({ id, describedBy, status }) => (
									<InputNumber
										id={id}
										aria-describedby={describedBy}
										value={stage.lagDays}
										onValueChange={(next: number | null) =>
											patch({
												lagDays: next === null ? 0 : Math.min(365, Math.max(0, Math.round(next))),
											})}
										min={0}
										max={365}
										suffix=" days"
										status={status}
										fluid
									/>
								)}
							</WizardField>
						</WizardRow>
					)}
				</>
			)}

			<WizardRow>
				{
					/*
					 * The timing MODEL always holds a value, so it can never be outstanding — it is a plain
					 * `FormControl` rather than a tiered field, and the verdict belongs to the control below
					 * that the model asks for. Tiering both would print one problem twice, on two rows, and
					 * leave the author looking for a second thing to answer.
					 */
				}
				<div class="pwz-field">
					<FormControl label="Due" hint="How this stage's delivery date is expressed.">
						{({ id, describedBy }) => (
							<Select
								id={id}
								aria-describedby={describedBy}
								options={DURATION_OPTIONS}
								value={stage.durationMode}
								onValueChange={(next: string) => setDurationMode(next as StageDurationMode)}
								fluid
								aria-label={`When ${stage.name || noun} is due`}
							/>
						)}
					</FormControl>
				</div>

				{stage.durationMode === "relative_duration" && (
					<WizardField
						field="stageDuration"
						stageKey={stage.key}
						label="Days allowed"
						hint="Counted from the moment this stage opens."
					>
						{({ id, describedBy, status }) => (
							<InputNumber
								id={id}
								aria-describedby={describedBy}
								value={stage.durationDays}
								onValueChange={(next: number | null) =>
									patch({
										durationDays: next === null ? null : Math.max(0, Math.round(next)),
									})}
								min={0}
								max={3650}
								placeholder="e.g. 14"
								status={status}
								fluid
							/>
						)}
					</WizardField>
				)}

				{stage.durationMode === "fixed_deadline" && (
					<WizardField field="stageDuration" stageKey={stage.key} label="Deadline">
						{({ id, describedBy, status }) => (
							<DatePicker
								id={id}
								aria-describedby={describedBy}
								value={toDate(stage.dueDate)}
								onValueChange={(next: DateValue) => patch({ dueDate: toIsoInstant(next) })}
								status={status}
								fluid
								aria-label={`Deadline for ${stage.name || noun}`}
							/>
						)}
					</WizardField>
				)}
			</WizardRow>
		</>
	);
}
// #endregion

// #region The step
export function StepTimeline(): JSX.Element {
	const draft = wizardDraft.value;
	const noun = stageNoun(draft.format);
	const pipeline = draft.format === "pipeline";

	return (
		<>
			{draft.hasStages
				? (
					<WizardGroup
						title={`When each ${noun} runs`}
						hint="The order is fixed on step 3. This is what each one waits on, and when it is owed."
					>
						<StageWorkbench
							title={stageNounPlural(draft.format)}
							empty={`Nothing to schedule yet — add a ${noun} on step 3, or leave the single delivery ${noun} the project is created with.`}
							summary={(stage) => scheduleSummary(stage, draft.stages)}
							inspector={(stage, index) => (
								<StageWhen
									key={stage.key}
									stage={stage}
									index={index}
									stages={draft.stages}
									noun={noun}
								/>
							)}
						/>
					</WizardGroup>
				)
				: (
					<WizardNote>
						A single-delivery engagement has nothing to sequence. Its due date is set on the
						delivery {noun} once the project exists.
					</WizardNote>
				)}

			{pipeline && (
				<WizardGroup
					title="Early delivery"
					hint={`Offer a ${BONUS_PERCENT}% uplift on the ticket price when a freelancer delivers ahead of the deadline.`}
				>
					<WizardField
						field="allowDeadlineBonuses"
						label="Offer a deadline bonus"
						required={false}
						hint={draft.allowDeadlineBonuses
							? "Freelancers see the uplift on every ticket raised against this project."
							: "Tickets are paid at their stated price whenever they land."}
					>
						{({ id, describedBy, status }) => (
							<ToggleSwitch
								id={id}
								aria-describedby={describedBy}
								value={draft.allowDeadlineBonuses}
								onValueChange={(allowDeadlineBonuses: boolean) =>
									patchDraft({ allowDeadlineBonuses })}
								status={status}
								aria-label="Offer a deadline bonus"
							/>
						)}
					</WizardField>
				</WizardGroup>
			)}

			{!pipeline && (
				<WizardNote>
					Early-delivery uplifts are a pipeline term — a one-off is paid for its milestones as they
					are accepted, so there is no per-ticket rate to uplift.
				</WizardNote>
			)}
		</>
	);
}
// #endregion

/** A stage's schedule in a few words, for the list beside the inspector. */
function scheduleSummary(stage: WizardStage, stages: readonly WizardStage[]): string | null {
	if (stage.durationMode === "relative_duration" && stage.durationDays !== null) {
		return `${stage.durationDays} days`;
	}
	if (stage.durationMode === "fixed_deadline" && stage.dueDate) {
		const date = toDate(stage.dueDate);
		return date ? date.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
	}
	if (stage.dependsOnKey !== null) {
		const target = stages.find((other) => other.key === stage.dependsOnKey);
		return target
			? `${stage.parallel ? "with" : "after"} ${target.name || "the stage above"}`
			: null;
	}
	return null;
}
