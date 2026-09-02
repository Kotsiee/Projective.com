import type { JSX } from "preact";
import { InputText, Select, SelectButton } from "@projective/ui/fields";
import { RichTextEditor } from "@projective/ui/editor";
import { patchDraft, setFormat, wizardDraft } from "../../core/wizard-state.ts";
import type { ProjectCreateFormat, ProjectVisibility } from "../../types/projects-types.ts";
import { WizardField, WizardGroup, WizardRow } from "./WizardField.tsx";
import { WizardBlock } from "./WizardBlock.tsx";
import { AttachmentField } from "./AttachmentField.tsx";
import {
	CURRENCY_OPTIONS,
	FORMAT_HINT,
	FORMAT_OPTIONS,
	VISIBILITY_OPTIONS,
} from "./wizard-vocab.ts";

/**
 * Step 1 — Details. The engagement's identity, its work-flow, what it is priced in, and who may
 * find it.
 *
 * Only the name and the work-flow block the step; everything else is the publishing gate, which is
 * the "quick to onboard, slow to set up" rule made operable rather than merely stated — an author
 * who has a name and knows the shape can be on step 2 in two answers.
 *
 * The visibility control asks what the author WANTS. What gets stored is
 * `effectiveVisibility(requested, ladder)`, computed by the fat service against the same ladder the
 * review step discloses, so nothing here decides its own reach.
 */

// #region Props
export interface StepDetailsProps {
	/**
	 * The library reference uploads are filed in — the acting user's id.
	 *
	 * `null` when the session could not be resolved, which the attachment control reports as a
	 * refusal rather than swallowing: a brief that looks complete and is missing the document it was
	 * written about is worse than one that says the upload did not land.
	 */
	ownerId: string | null;
}
// #endregion

export function StepDetails(props: StepDetailsProps): JSX.Element {
	const draft = wizardDraft.value;

	return (
		<>
			<WizardField field="title" label="Project name" hint="The first thing a freelancer reads.">
				{({ id, describedBy, status }) => (
					<InputText
						id={id}
						aria-describedby={describedBy}
						value={draft.title}
						onValueChange={(next: string) => patchDraft({ title: next })}
						placeholder="Name your project"
						maxLength={160}
						status={status}
						block
					/>
				)}
			</WizardField>

			<WizardField
				field="format"
				label="How the work runs"
				hint={FORMAT_HINT[wizardFormat(draft.format)]}
			>
				{({ id, describedBy, status }) => (
					<SelectButton
						id={id}
						aria-describedby={describedBy}
						options={FORMAT_OPTIONS}
						value={wizardFormat(draft.format)}
						onValueChange={(next: string | string[]) => setFormat(next as ProjectCreateFormat)}
						status={status}
						aria-label="How the work runs"
					/>
				)}
			</WizardField>

			<WizardField
				field="scope"
				label="Brief"
				hint="Describe the work, the goal and the context, so a freelancer can judge whether they fit it."
			>
				{({ id, status }) => (
					<RichTextEditor
						id={id}
						value={draft.scope}
						onValueChange={(next: string) => patchDraft({ scope: next })}
						placeholder="What needs doing, why, and what “done” looks like…"
						status={status}
						minRows={5}
						aria-label="Project brief"
					/>
				)}
			</WizardField>

			<WizardRow>
				<WizardField
					field="currency"
					label="Currency"
					hint="Every price on this engagement is quoted in it."
				>
					{({ id, describedBy, status }) => (
						<Select
							id={id}
							aria-describedby={describedBy}
							options={CURRENCY_OPTIONS}
							value={draft.currency}
							onValueChange={(next: string) =>
								// The budget carries its own copy of the code, and this field is the
								// authoritative one — so the two move together rather than leaving a
								// figure quoted in a currency the engagement no longer uses.
								patchDraft({
									currency: next,
									budget: draft.budget === null ? null : { ...draft.budget, currency: next },
								})}
							filter
							filterPlaceholder="Find a currency…"
							status={status}
							fluid
							aria-label="Currency"
						/>
					)}
				</WizardField>

				<WizardField
					field="visibility"
					label="Visibility"
					hint="What you are asking for. Step 6 says what it will actually be listed as."
				>
					{({ id, describedBy, status }) => (
						<Select
							id={id}
							aria-describedby={describedBy}
							options={VISIBILITY_OPTIONS}
							value={draft.visibility}
							onValueChange={(next: string) =>
								patchDraft({ visibility: next as ProjectVisibility })}
							status={status}
							fluid
							aria-label="Visibility"
						/>
					)}
				</WizardField>
			</WizardRow>

			<WizardGroup
				title="Reference material"
				hint="Anything a freelancer should read before deciding — a spec, a brand sheet, last year's report."
			>
				{
					/*
					 * A `WizardBlock`, not a `WizardField`: the control is a pick button plus a removable
					 * list plus a status line, and a `<label for>` can only point at one of them. A named
					 * region says what all three are for without claiming to label any single one.
					 */
				}
				<WizardBlock field="attachmentIds" label="Attachments" hint="Up to ten files.">
					<AttachmentField
						ids={draft.attachmentIds}
						onChange={(attachmentIds) => patchDraft({ attachmentIds })}
						ownerId={props.ownerId}
						max={10}
						label="Attach files"
					/>
				</WizardBlock>
			</WizardGroup>
		</>
	);
}

// #region Offer narrowing
/**
 * The work-flow as the two-option control expresses it.
 *
 * The enum keeps three members and the wizard offers two: a Direct Deliverable is not a third
 * choice, it is the stages-off variant of a one-off, and the Stages step's toggle is where that
 * decision belongs. Narrowing here rather than at the seed keeps a launcher free to hand the wizard
 * whichever member it holds without the segmented control landing on a value it cannot draw.
 */
function wizardFormat(format: ProjectCreateFormat): "pipeline" | "one_off" {
	return format === "pipeline" ? "pipeline" : "one_off";
}
// #endregion
