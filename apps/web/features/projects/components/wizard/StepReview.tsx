import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { styleVars } from "@ui/core/style.ts";
import {
	outstandingSteps,
	type ProjectSetupStep,
	type ProjectWizardField,
	type ProjectWizardStep,
	WIZARD_STEP_FIELDS,
	WIZARD_STEP_LABEL,
} from "../../types/projects-types.ts";
import {
	goToStep,
	outstandingForPosting,
	wizardCompleteness,
	wizardDraft,
	wizardEffectiveVisibility,
	wizardLadder,
	type WizardProblem,
	wizardStageKey,
} from "../../core/wizard-state.ts";
import { WizardGroup } from "./WizardField.tsx";
import { VISIBILITY_LABEL } from "./wizard-vocab.ts";

/**
 * Step 6 — Review & Publish. What is ready, what is outstanding, and how this will actually be
 * listed.
 *
 * It owns NO controls of its own. Everything here is derived, and derived by the same functions the
 * server runs: the ladder is `setupSteps`, the percentage is `setupCompleteness`, and the visibility
 * sentence is `effectiveVisibility` — so what an author reads here and what the database receives
 * are one decision rather than two implementations that agree today.
 *
 * The meter's geometry is written straight from the percentage and is NEVER transitioned. A
 * backgrounded tab freezes the animation clock, and a bar whose width arrives through a transition
 * then renders at 0% on a draft that has real progress — motion decorating a fact this repo has
 * already shipped twice.
 *
 * Every outstanding row carries the control that answers it, not just its name. A list of things
 * that are missing, with no route to any of them, makes the author go hunting across five screens
 * for a field they have already been told about.
 */

// #region Field → step
/**
 * Which step owns a control.
 *
 * Built by inverting `WIZARD_STEP_FIELDS` rather than by a second table: the step that RENDERS a
 * control and the step a "fix this" link opens must be the same step, and two lists is how they come
 * to differ for one field nobody notices.
 */
const STEP_OF_FIELD: Partial<Record<ProjectWizardField, ProjectWizardStep>> = Object.fromEntries(
	(Object.entries(WIZARD_STEP_FIELDS) as [ProjectWizardStep, readonly ProjectWizardField[]][])
		.flatMap(([step, fields]) => fields.map((field) => [field, step] as const)),
);

/** Open the step that owns an outstanding answer, and select the stage it belongs to. */
function jumpTo(problem: WizardProblem): void {
	const step = STEP_OF_FIELD[problem.field];
	if (!step) return;
	if (problem.stageKey) wizardStageKey.value = problem.stageKey;
	goToStep(step);
}

/** The stage's position and name, for a problem that belongs to one row rather than the project. */
function whereLabel(problem: WizardProblem): string | null {
	if (!problem.stageKey) return null;
	const stages = wizardDraft.value.stages;
	const index = stages.findIndex((stage) => stage.key === problem.stageKey);
	if (index === -1) return null;
	return `${index + 1}. ${stages[index].name || "Untitled"}`;
}
// #endregion

// #region Rows
function LadderRow({ step }: { step: ProjectSetupStep }): JSX.Element {
	return (
		<li class="pwz-ladder__row" data-done={step.done ? "true" : undefined}>
			<span class="pwz-ladder__mark" aria-hidden="true">
				<Icon name={step.done ? "check" : "minus"} size="xs" />
			</span>
			<span class="pwz-ladder__label">
				{step.label}
				<span class="ui-visually-hidden">{step.done ? " — done" : " — not done"}</span>
			</span>
			<span class="pwz-ladder__meta">
				{step.required ? "Required to post" : "Optional"}
				{!step.done && step.hint ? ` · ${step.hint}` : ""}
			</span>
		</li>
	);
}
// #endregion

export function StepReview(): JSX.Element {
	const draft = wizardDraft.value;
	const ladder = wizardLadder.value;
	const percent = wizardCompleteness.value;
	const effective = wizardEffectiveVisibility.value;
	const outstanding = outstandingForPosting(draft);
	const unmetLadder = outstandingSteps(ladder);
	const willFallBack = effective !== draft.visibility;

	return (
		<>
			<WizardGroup
				title="Readiness"
				hint="The same ladder the project's own setup page shows once it exists."
			>
				<div class="pwz-meter">
					<div
						class="pwz-meter__track"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={percent}
						aria-label="Setup completeness"
					>
						{
							/*
							 * The width is a custom property, not a raw declaration: the datum crosses into CSS
							 * through the variable-mapping pattern, and the sheet gives it no transition — an
							 * animated width would render 0% in a background tab, where the animation clock is
							 * frozen.
							 */
						}
						<span
							class="pwz-meter__fill"
							style={styleVars({ "--pwz-meter-pct": `${percent}%` })}
						/>
					</div>
					<span class="pwz-meter__value">{percent}%</span>
				</div>

				<ul class="pwz-ladder">
					{ladder.map((step) => <LadderRow key={step.key} step={step} />)}
				</ul>
			</WizardGroup>

			<WizardGroup
				title="How this will be listed"
				hint="Decided by the server from the ladder above, not by this form."
			>
				<div class="pwz-disclose" data-tone={willFallBack ? "gate" : "plain"}>
					<p class="pwz-disclose__title">
						{willFallBack
							? `You asked for “${VISIBILITY_LABEL[draft.visibility]}”. It will be created ${
								VISIBILITY_LABEL[effective]
							}.`
							: `It will be created ${VISIBILITY_LABEL[effective]}.`}
					</p>
					{willFallBack && (
						<>
							<p class="pwz-disclose__body">
								A listed engagement is a promise to the freelancers who find it, so the request is
								honoured once every required step is done. Until then it is reachable by its owner
								and by anyone holding the link, and absent from Explore. Outstanding:
							</p>
							<ul class="pwz-disclose__list">
								{unmetLadder.map((step) => (
									<li key={step.key}>
										<span class="pwz-disclose__req">{step.label}</span>
										{step.hint ? ` — ${step.hint}` : ""}
									</li>
								))}
							</ul>
						</>
					)}
				</div>
			</WizardGroup>

			<WizardGroup
				title="Before you post"
				hint="None of this stops the project being created — it is what a freelancer needs before they can judge it."
			>
				{outstanding.length === 0
					? (
						<p class="pwz-todo__clear">
							<Icon name="check" size="sm" />
							Nothing outstanding. Create the project and it is ready to open for hiring.
						</p>
					)
					: (
						<ul class="pwz-todo">
							{outstanding.map((problem, index) => {
								const where = whereLabel(problem);
								const step = STEP_OF_FIELD[problem.field];
								return (
									<li
										key={`${problem.field}:${problem.stageKey ?? ""}:${index}`}
										class="pwz-todo__row"
									>
										<span class="pwz-todo__text">
											{where && <span class="pwz-todo__where">{where}</span>}
											{problem.message}
										</span>
										{step && (
											<button
												type="button"
												class="pwz-todo__jump"
												onClick={() => jumpTo(problem)}
											>
												{WIZARD_STEP_LABEL[step]}
												<Icon name="chevron-right" size="xs" />
											</button>
										)}
									</li>
								);
							})}
						</ul>
					)}
			</WizardGroup>
		</>
	);
}
