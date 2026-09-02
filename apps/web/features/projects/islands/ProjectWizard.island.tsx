import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "../styles/project-wizard.css";
// The stage step list is the ticket's own `TaskListEditor`, whose chrome lives in the ticket
// composition sheet. Feature CSS reaches a page only through an island's import graph, so the sheet
// is pulled in here or the reused component arrives unstyled.
import "../styles/ticket-pipeline.css";
import { Button, FieldLegend } from "@projective/ui/fields";
import { Message } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { type ProjectWizardStep, WIZARD_STEP_LABEL } from "../types/projects-types.ts";
import {
	goBack,
	goNext,
	goToStep,
	seedWizard,
	stepIndex,
	stepProblems,
	submitWizard,
	WIZARD_STEPS,
	wizardBlockers,
	wizardCanCreate,
	wizardCreated,
	type WizardDraft,
	wizardDraft,
	wizardError,
	type WizardProblem,
	wizardReveal,
	type WizardSeed,
	wizardStep,
	wizardSubmitting,
} from "../core/wizard-state.ts";
import { WIZARD_STEP_LEDE, WizardStepper } from "../components/wizard/WizardStepper.tsx";
import { StepDetails } from "../components/wizard/StepDetails.tsx";
import { StepLegal } from "../components/wizard/StepLegal.tsx";
import { StepStages } from "../components/wizard/StepStages.tsx";
import { StepTimeline } from "../components/wizard/StepTimeline.tsx";
import { StepBudget } from "../components/wizard/StepBudget.tsx";
import { StepReview } from "../components/wizard/StepReview.tsx";

/**
 * ProjectWizard — the body of `/projects/create`, and the only hydration root the six-step flow has.
 *
 * A dumb view over `core/wizard-state.ts` (root CLAUDE.md §2): it renders the step on screen and
 * calls a named intent. Nothing here decides whether a step may be left, what is outstanding, how
 * complete the draft is or what visibility it will be stored under — those are the state layer's,
 * and the state layer derives them from the SAME functions the fat service runs, so the sentence an
 * author reads and the row the database receives are one decision.
 *
 * **One island, not seven.** The rail, the panel and the footer all read the same draft and the
 * same problem list, and splitting them into separate roots would mean a cross-island bridge for
 * state that is already in one module — plus three chances for the rail to describe a step the panel
 * is not showing. It is also the surface's stylesheet carrier: feature CSS reaches a page only
 * through an island's import graph.
 *
 * **Focus follows the step, but never on arrival.** A page that steals focus the moment it paints
 * takes the reader somewhere they did not ask to go; a step change is a navigation they DID ask for,
 * and leaving focus on a Next button that has just moved out from under them strands a keyboard
 * reader at the bottom of a screen they have not read.
 */

// #region Refusals
/**
 * The earliest step that is holding the flow up, when it is not the one on screen.
 *
 * `canEnter` checks every step BETWEEN where you are and where you pressed, so jumping from a clean
 * step 1 to step 5 can be refused by a blocker on step 3 — and the current step's verdict list is
 * then empty, which reads as a control that did nothing. This finds the step the refusal was
 * actually about so the footer can name it and offer the way there.
 *
 * It is the FIRST such step rather than all of them: the author has to answer that one before any
 * of the others can matter, and a list spanning three screens is a worse answer than a route to the
 * next thing to do.
 */
function firstBlockedStep(
	draft: WizardDraft,
): { step: ProjectWizardStep; problems: WizardProblem[] } | null {
	for (const step of WIZARD_STEPS) {
		const problems = stepProblems(draft, step).filter((problem) => problem.tier === "T1");
		if (problems.length > 0) return { step, problems };
	}
	return null;
}
// #endregion

// #region Props
export interface ProjectWizardProps {
	/**
	 * What the route knows before the wizard opens — the work-flow the launcher preset and the
	 * workspace the engagement is filed under.
	 *
	 * Resolved SERVER-side from the acting context, so the payload's two scope fields cannot
	 * contradict each other. The fat service re-derives the owning workspace from the actor anyway;
	 * sending the truth simply means the two agree.
	 */
	seed: WizardSeed;
	/** The acting user's id — the library reference uploads and a custom NDA are filed in. */
	ownerId: string | null;
}
// #endregion

export default function ProjectWizard(props: ProjectWizardProps): JSX.Element {
	// Adopted in the render body, per the store's own contract: the first paint has to already show
	// the launcher's chosen work-flow, and a draft that arrived a frame later would render the wrong
	// stage vocabulary and then change it under the author's cursor. It is idempotent per seed, so a
	// re-render never discards live edits.
	seedWizard(props.seed);

	const step = wizardStep.value;
	const draft = wizardDraft.value;
	const index = stepIndex(step);
	const last = index === WIZARD_STEPS.length - 1;
	const blockers = wizardBlockers.value;
	const revealed = wizardReveal.value;
	const error = wizardError.value;
	const created = wizardCreated.value;
	const submitting = wizardSubmitting.value;
	// A refusal whose cause is not on this screen. Resolved only when there is one, so the common
	// case — the blocker is right here — costs nothing.
	const upstream = revealed && blockers.length === 0 ? firstBlockedStep(draft) : null;

	const headingRef = useRef<HTMLHeadingElement>(null);
	const painted = useRef(false);
	useEffect(() => {
		if (!painted.current) {
			painted.current = true;
			return;
		}
		headingRef.current?.focus();
	}, [step]);

	return (
		<div class="pwz">
			<header class="pwz__head">
				<p class="pwz__eyebrow">New project</p>
				<h1 class="pwz__title">Set up the engagement</h1>
				<p class="pwz__lede">
					A name is all it takes to create it. Everything else shapes how freelancers see the work —
					and you can come back to any of it later.
				</p>
			</header>

			<WizardStepper draft={draft} current={step} />

			<div class="pwz__panel">
				<div class="pwz__panelhead">
					<h2 class="pwz__steptitle" ref={headingRef} tabIndex={-1}>
						<span class="pwz__stepcount">Step {index + 1} of {WIZARD_STEPS.length}</span>
						{WIZARD_STEP_LABEL[step]}
					</h2>
					<p class="pwz__steplede">{WIZARD_STEP_LEDE[step]}</p>
				</div>

				<div class="pwz__body">
					{step === "details" && <StepDetails ownerId={props.ownerId} />}
					{step === "legal" && <StepLegal ownerId={props.ownerId} />}
					{step === "stages" && <StepStages />}
					{step === "timeline" && <StepTimeline />}
					{step === "budget" && <StepBudget />}
					{step === "review" && <StepReview />}
				</div>
			</div>

			<footer class="pwz__foot">
				<div class="pwz__status">
					{error && <Message severity="danger" text={error} />}

					{created && !submitting && (
						<Message severity="warning">
							The project was created. Open it at{" "}
							<a href={`/projects/${created.slug}`}>/projects/{created.slug}</a>.
						</Message>
					)}

					{
						/*
						 * Only after a refusal, and only for the step being left. A blocker the author has not
						 * reached has nothing to say to them yet — the whole reason the rail never marks a step
						 * ahead of where they are.
						 */
					}
					{revealed && blockers.length > 0 && (
						<ul class="pwz-alert" role="alert">
							{blockers.map((problem, position) => (
								<li key={`${problem.field}:${problem.stageKey ?? ""}:${position}`}>
									<Icon name="warning" size="xs" />
									{problem.message}
								</li>
							))}
						</ul>
					)}

					{upstream && (
						<div class="pwz-alert" role="alert">
							<p class="pwz-alert__lead">
								<Icon name="warning" size="xs" />
								{WIZARD_STEP_LABEL[upstream.step]} still needs an answer:
							</p>
							<ul class="pwz-alert__list">
								{upstream.problems.map((problem, position) => (
									<li key={`${problem.field}:${problem.stageKey ?? ""}:${position}`}>
										{problem.message}
									</li>
								))}
							</ul>
							<button
								type="button"
								class="pwz-todo__jump"
								onClick={() => goToStep(upstream.step)}
							>
								Go to {WIZARD_STEP_LABEL[upstream.step]}
								<Icon name="chevron-right" size="xs" />
							</button>
						</div>
					)}

					<FieldLegend text="Needed to move on" />
				</div>

				<div class="pwz__actions">
					{index > 0 && (
						<Button
							variant="text"
							severity="secondary"
							label="Back"
							icon={<Icon name="chevron-left" size="sm" />}
							onClick={() => goBack()}
						/>
					)}

					{
						/*
						 * A `T1` blocks the STEP, not the record. Only a title is needed to create a draft, and
						 * a one-off's per-milestone fee is `T1` — so without this control an author with three
						 * unpriced milestones could not create the project at all, which is a stronger gate than
						 * the tier taxonomy actually declares. Low emphasis, and absent until there is something
						 * to create, so exactly one filled action is ever on screen.
						 */
					}
					{!last && wizardCanCreate.value && (
						<Button
							variant="text"
							severity="primary"
							label={submitting ? "Creating…" : "Create now"}
							loading={submitting}
							onClick={() => void submitWizard()}
						/>
					)}

					{last
						? (
							<Button
								variant="filled"
								severity="primary"
								label={submitting ? "Creating…" : "Create project"}
								loading={submitting}
								disabled={!wizardCanCreate.value}
								onClick={() => void submitWizard()}
							/>
						)
						: (
							<Button
								variant="filled"
								severity="primary"
								label="Next"
								icon={<Icon name="chevron-right" size="sm" />}
								iconPos="right"
								onClick={() => goNext()}
							/>
						)}
				</div>
			</footer>
		</div>
	);
}
