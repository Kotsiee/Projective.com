import type { JSX } from "preact";
import type { ProjectSetup, ProjectSetupStepKey } from "../../types/projects-types.ts";
import type { SetupSectionKey } from "../../core/setup-sections.ts";
import { BasicsSection, BudgetSection, DescriptionSection } from "./SetupBriefSection.tsx";
import { FlatDetailsSection, StageListSection } from "./SetupStagesSection.tsx";
import { RoleListSection } from "./SetupRolesSection.tsx";
import { AttachmentsSection } from "./SetupAttachmentsSection.tsx";
import { RulesSection } from "./SetupLegalSection.tsx";

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
 * **Every field of {@link ProjectSetup} is bound to a control here.** A term chosen once at creation
 * and then invisible is a term nobody can ever fix, so the six wizard steps land here as controls
 * rather than as a second surface: the engagement terms in Rules, the engagement's shape in Basics,
 * and the whole of a stage's configuration — steps, skills, seats, sequencing, timing, submission
 * rules and its confidentiality override — inside the stage's own disclosure.
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

// #region Section modules
/**
 * Every section, layout primitive and stage editor the form is built from, re-exported so the two
 * hydration roots that render them (`ProjectSetupForm`, `StageDetailsForm`) import from this one
 * module whichever file each piece lives in.
 */
export { Field, Section, Validated } from "./setup-primitives.tsx";
export { BasicsSection, BudgetSection, DescriptionSection } from "./SetupBriefSection.tsx";
export { StageFields, type StageFieldsProps } from "./SetupStageFields.tsx";
export {
	FlatDetailsSection,
	predecessorOptionsFor,
	StageListSection,
} from "./SetupStagesSection.tsx";
export { RoleListSection } from "./SetupRolesSection.tsx";
export { AttachmentsSection } from "./SetupAttachmentsSection.tsx";
export { RulesSection } from "./SetupLegalSection.tsx";
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
		case "details":
			return <FlatDetailsSection setup={setup} hint={hintFor(setup, "pricing")} />;
		case "budget":
			return <BudgetSection setup={setup} hint={hintFor(setup, "pricing")} />;
		case "stages":
			// TWO rungs land on this one section, and it is the only section they can land on: with the
			// Budget section withheld from a staged run, `pricing` has no other home and would otherwise
			// be a requirement stated nowhere on the page. `stages` is preferred while it is outstanding
			// because the two are ordered in fact — there is no stage to price until one exists — so the
			// hint always names the thing the owner can actually do next.
			return (
				<StageListSection
					setup={setup}
					hint={hintFor(setup, "stages") ?? hintFor(setup, "pricing")}
				/>
			);
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
