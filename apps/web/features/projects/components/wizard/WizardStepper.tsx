import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import { type ProjectWizardStep, WIZARD_STEP_LABEL } from "../../types/projects-types.ts";
import {
	goToStep,
	stepIndex,
	stepProblems,
	WIZARD_STEPS,
	type WizardDraft,
} from "../../core/wizard-state.ts";

/**
 * WizardStepper — the six-step rail, and the one place a step's progress is stated.
 *
 * Every rung stays PRESSABLE, including one the draft cannot reach yet. Disabling it would say that
 * something is wrong without saying what, and the flow already has a better answer:
 * {@link goToStep} refuses and flips the reveal, so the refused press paints the verdicts on the
 * step being left and the author is looking straight at the control that owes an answer.
 *
 * **A rung ahead of the author is never marked.** Its state is `ahead` regardless of what the draft
 * holds, because a red mark on step 5 before anyone has opened it is the early warning the whole
 * touch-based validation policy exists to avoid. Only a step already passed reports a verdict — and
 * it can genuinely carry one, since going back and clearing a blocker leaves a step behind you that
 * no longer holds together.
 */

// #region Copy
/**
 * What each step is for, in one sentence.
 *
 * Kept beside the step NAMES rather than with the field vocabulary: the rung and the panel heading
 * are two presentations of one identity, and a step renamed in one place and described in another
 * is how the rail and the body come to disagree about which step you are on.
 */
export const WIZARD_STEP_LEDE: Record<ProjectWizardStep, string> = {
	details: "What the engagement is, who may see it, and what it is priced in.",
	legal: "The terms everyone joining accepts, and who you will accept.",
	stages: "The units of work, and what each one owes.",
	timeline: "What waits on what, and when each piece is due.",
	budget: "What the work costs, and how many people may take it on.",
	review: "What is ready, what is outstanding, and how this will be listed.",
};
// #endregion

// #region State
/** How a rung reports itself. Never five states, and never a colour on its own. */
type RungState = "done" | "attention" | "current" | "ahead";

/** The rung's own words, so the mark, the class and the accessible name cannot disagree. */
const RUNG_STATUS: Record<RungState, string> = {
	done: "complete",
	attention: "needs an answer",
	current: "current step",
	ahead: "not started",
};

function rungState(
	draft: WizardDraft,
	step: ProjectWizardStep,
	current: ProjectWizardStep,
): RungState {
	if (step === current) return "current";
	if (stepIndex(step) > stepIndex(current)) return "ahead";
	return stepProblems(draft, step).some((problem) => problem.tier === "T1") ? "attention" : "done";
}
// #endregion

// #region The rail
export interface WizardStepperProps {
	/** The draft the rungs report on. */
	draft: WizardDraft;
	/** The step on screen. */
	current: ProjectWizardStep;
}

export function WizardStepper(props: WizardStepperProps): JSX.Element {
	const total = WIZARD_STEPS.length;

	return (
		<nav class="pwz-rail" aria-label="Project creation steps">
			<ol class="pwz-rail__list">
				{WIZARD_STEPS.map((step, index) => {
					const state = rungState(props.draft, step, props.current);
					return (
						<li key={step} class="pwz-rail__item">
							<button
								type="button"
								class="pwz-rail__button"
								data-state={state}
								aria-current={state === "current" ? "step" : undefined}
								onClick={() => goToStep(step)}
							>
								<span class="pwz-rail__mark" aria-hidden="true">
									{state === "done"
										? <Icon name="check" size="xs" />
										: state === "attention"
										? <Icon name="warning" size="xs" />
										: index + 1}
								</span>
								<span class="pwz-rail__label">{WIZARD_STEP_LABEL[step]}</span>
								<span class="ui-visually-hidden">
									, step {index + 1} of {total}, {RUNG_STATUS[state]}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
// #endregion
