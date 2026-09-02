import type { JSX } from "preact";
import { Chips, FormControl, InputText, MultiSelect, ToggleSwitch } from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import {
	patchStage,
	setHasStages,
	wizardDraft,
	type WizardStage,
} from "../../core/wizard-state.ts";
import { TaskListEditor } from "../ticket/TaskListEditor.tsx";
import type { TicketTask } from "../../types/projects-types.ts";
import { WizardField, WizardGroup, WizardNote } from "./WizardField.tsx";
import { WizardBlock } from "./WizardBlock.tsx";
import { StageWorkbench } from "./StageWorkbench.tsx";
import { FILE_CATEGORY_OPTIONS, stageNoun, stageNounPlural } from "./wizard-vocab.ts";

/**
 * Step 3 — Stages (the "what"). The units of work, and what each one owes.
 *
 * The `hasStages` toggle is the whole step's gate, and turning it OFF discards nothing: the payload
 * builder sends only the list the engagement's shape calls for, so an author who looks at the
 * role-staffed model and comes back finds their stages exactly where they left them.
 *
 * **Nothing here blocks on the LIST being non-empty.** A project that declares no stages still gets
 * one — `projects.create_project` mints a single delivery stage after its stage loop, carrying the
 * project's own scope — so demanding a stage from the author would be a requirement the server has
 * already answered. What blocks is a stage that exists and has no name.
 *
 * The step-list editor is the ticket's own {@link TaskListEditor}, not a second one: a stage's steps
 * ARE the checklist a ticket raised against it is seeded from, so they are the same list at two
 * moments and editing them with two components is how the two slowly grow different affordances.
 */

// #region Step-label projection
/**
 * A stage's step labels as the ticket task list's row shape, and back.
 *
 * Lossy in one direction only, and deliberately: a template step has nobody to have completed it and
 * no submission behind it, so the completion channel is a constant here and the component is asked
 * to hide it rather than render an unbroken column of empty marks.
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

// #region The stage inspector
interface StageWhatProps {
	stage: WizardStage;
	noun: string;
}

/**
 * What one stage IS — its name, its scope, its checklist, its skills and its delivery contract.
 *
 * Mounted with a `key` on the stage's client identity by the caller. Without it Preact reuses this
 * instance across a selection change, and every control seeded from a raw value keeps the PREVIOUS
 * stage's answer while the header above it names the new one — the island-reuse defect this repo has
 * already shipped once on the chat feed.
 */
function StageWhat({ stage, noun }: StageWhatProps): JSX.Element {
	const patch = (next: Partial<WizardStage>) => patchStage(stage.key, next);

	return (
		<>
			<WizardField field="stageName" stageKey={stage.key} label={`${initialCap(noun)} name`}>
				{({ id, describedBy, status }) => (
					<InputText
						id={id}
						aria-describedby={describedBy}
						value={stage.name}
						onValueChange={(name: string) => patch({ name })}
						placeholder="e.g. Discovery"
						maxLength={120}
						status={status}
						block
					/>
				)}
			</WizardField>

			<WizardField
				field="stageDescription"
				stageKey={stage.key}
				label="Scope"
				hint="Deliverables, acceptance criteria, anything the provider is judged against."
			>
				{({ id, status }) => (
					<RichTextEditor
						id={id}
						value={stage.description}
						onValueChange={(description: string) => patch({ description })}
						placeholder="What this stage produces, and what makes it done…"
						status={status}
						minRows={4}
						aria-label={`Scope for ${stage.name || noun}`}
					/>
				)}
			</WizardField>

			<WizardBlock
				field="stageTasks"
				label="Steps"
				hint="Every ticket raised against this stage starts from this checklist."
			>
				<TaskListEditor
					tasks={asTaskRows(stage.tasks)}
					onChange={(next) => patch({ tasks: asStepLabels(next) })}
					label={`Steps for ${stage.name || noun}`}
					placeholder="Add a step…"
					hideProgress
				/>
			</WizardBlock>

			<WizardField
				field="stageSkills"
				stageKey={stage.key}
				label="Skills"
				hint="Up to ten. Used to match freelancers to the work."
			>
				{({ id, describedBy, status }) => (
					<Chips
						id={id}
						aria-describedby={describedBy}
						value={stage.skills}
						onValueChange={(skills: string[]) => patch({ skills })}
						placeholder="Add a skill…"
						max={10}
						addOnBlur
						status={status}
						fluid
						aria-label={`Skills for ${stage.name || noun}`}
					/>
				)}
			</WizardField>

			<div class="pwz-field">
				<FormControl
					label="Deliverable"
					hint="What is owed at the end of this stage — never when it is owed."
				>
					{({ id, describedBy }) => (
						<InputText
							id={id}
							aria-describedby={describedBy}
							value={stage.milestone}
							onValueChange={(milestone: string) => patch({ milestone })}
							placeholder="e.g. A signed-off wireframe set"
							maxLength={240}
							block
						/>
					)}
				</FormControl>
			</div>

			<WizardField
				field="stageRequiresFiles"
				stageKey={stage.key}
				label="Submissions must carry a file"
				hint={stage.requiresFiles
					? "A provider cannot close this stage without uploading something."
					: "This stage can be closed on a note alone — the review workspace will have nothing to open."}
			>
				{({ id, describedBy, status }) => (
					<ToggleSwitch
						id={id}
						aria-describedby={describedBy}
						value={stage.requiresFiles}
						onValueChange={(requiresFiles: boolean) => patch({ requiresFiles })}
						status={status}
						aria-label={`Submissions must carry a file for ${stage.name || noun}`}
					/>
				)}
			</WizardField>

			<details class="pwz-adv">
				<summary class="pwz-adv__summary">Advanced</summary>
				<div class="pwz-adv__body">
					<WizardField
						field="stageAllowedFileTypes"
						stageKey={stage.key}
						label="Accepted categories"
						hint="Leave empty to accept every category."
					>
						{({ id, describedBy, status }) => (
							<MultiSelect
								id={id}
								aria-describedby={describedBy}
								options={FILE_CATEGORY_OPTIONS}
								value={stage.allowedFileCategories}
								onValueChange={(next: string[]) =>
									patch({
										allowedFileCategories: next as WizardStage["allowedFileCategories"],
									})}
								placeholder="Any category"
								display="chip"
								status={status}
								fluid
								aria-label={`Accepted categories for ${stage.name || noun}`}
							/>
						)}
					</WizardField>

					<div class="pwz-field">
						<FormControl
							label="Accepted extensions"
							hint="Without the dot. Leave empty to accept every extension."
						>
							{({ id, describedBy }) => (
								<Chips
									id={id}
									aria-describedby={describedBy}
									value={stage.allowedFileExtensions}
									onValueChange={(allowedFileExtensions: string[]) =>
										patch({ allowedFileExtensions })}
									placeholder="e.g. fig, psd, pdf"
									max={50}
									addOnBlur
									fluid
									aria-label={`Accepted extensions for ${stage.name || noun}`}
								/>
							)}
						</FormControl>
					</div>

					{
						/*
						 * The visible label and the accessible name must not diverge (WCAG 2.5.3): the
						 * control's name qualifies it with the stage's own name, so the label is the phrase
						 * that name CONTAINS rather than a different wording of the same idea.
						 */
					}
					<WizardField
						field="stageNdaOverride"
						stageKey={stage.key}
						label="Stricter confidentiality"
						hint="Recorded on the stage. Nothing enforces it yet — the no-download, watermark and owner-only rules read no stage flag today."
					>
						{({ id, describedBy, status }) => (
							<ToggleSwitch
								id={id}
								aria-describedby={describedBy}
								value={stage.ndaOverride}
								onValueChange={(ndaOverride: boolean) => patch({ ndaOverride })}
								status={status}
								aria-label={`Stricter confidentiality on ${stage.name || noun}`}
							/>
						)}
					</WizardField>
				</div>
			</details>
		</>
	);
}
// #endregion

// #region The step
export function StepStages(): JSX.Element {
	const draft = wizardDraft.value;
	const noun = stageNoun(draft.format);

	return (
		<>
			<WizardField
				field="hasStages"
				label="Break the work into stages"
				required={false}
				hint={draft.hasStages
					? `Each ${noun} is scoped, priced and staffed on its own.`
					: "One delivery, staffed by the team roles you name on step 5."}
			>
				{({ id, describedBy, status }) => (
					<ToggleSwitch
						id={id}
						aria-describedby={describedBy}
						value={draft.hasStages}
						onValueChange={setHasStages}
						status={status}
						aria-label="Break the work into stages"
					/>
				)}
			</WizardField>

			{draft.hasStages
				? (
					<WizardGroup
						title={stageNounPlural(draft.format)}
						hint={`Drag to reorder — the order here IS the delivery sequence. Leave the list empty and a single delivery ${noun} is created for you.`}
					>
						<StageWorkbench
							title={stageNounPlural(draft.format)}
							reorderable
							editable
							empty={`No ${noun}s yet. Add one, or leave it — a single delivery ${noun} is created either way.`}
							summary={(stage) => stage.skills.length > 0 ? `${stage.skills.length} skills` : null}
							inspector={(stage) => <StageWhat key={stage.key} stage={stage} noun={noun} />}
						/>
					</WizardGroup>
				)
				: (
					<WizardNote>
						A single delivery {noun}{" "}
						is created with the project, carrying the brief you wrote on step 1. Staffing moves to
						named team roles on step 5, and the schedule to the project itself on step 4.
					</WizardNote>
				)}
		</>
	);
}
// #endregion

/** Sentence-case a stage noun for a label that opens a line. */
function initialCap(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}
