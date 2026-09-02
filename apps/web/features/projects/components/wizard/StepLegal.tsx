import type { JSX } from "preact";
import { Chips, Select } from "@projective/ui/fields";
import { patchDraft, setNdaMode, wizardDraft } from "../../core/wizard-state.ts";
import type {
	IpOwnershipMode,
	NdaMode,
	PortfolioDisplayRights,
} from "../../types/projects-types.ts";
import { WizardField, WizardGroup, WizardNote, WizardRow } from "./WizardField.tsx";
import { WizardBlock } from "./WizardBlock.tsx";
import { AttachmentField } from "./AttachmentField.tsx";
import { IP_OPTIONS, NDA_HINT, NDA_OPTIONS, PORTFOLIO_OPTIONS } from "./wizard-vocab.ts";

/**
 * Step 2 — Legal & Screening. What the client takes ownership of, what everyone joining accepts,
 * and who the engagement will accept.
 *
 * The two screening lists are deliberately NOT blockers. An empty language list means "any
 * language" and an empty location list means "anywhere" — both are answers, and treating an empty
 * restriction as an omission would push every author into narrowing an engagement they had no
 * reason to narrow.
 *
 * The custom-NDA document is an untiered {@link WizardBlock}: it has no entry in the wizard's field
 * taxonomy because it is not a decision on its own, it is the second half of the mode above it.
 * `setNdaMode` drops a stale reference on any move away from `custom`, which is what keeps
 * `ck_projects_nda_document` from being tripped by a mode switch alone.
 */

// #region Props
export interface StepLegalProps {
	/** The library a custom NDA is filed in — the acting user's id. */
	ownerId: string | null;
}
// #endregion

export function StepLegal(props: StepLegalProps): JSX.Element {
	const draft = wizardDraft.value;

	return (
		<>
			<WizardGroup
				title="Ownership"
				hint="What changes hands when the work is delivered, and what the provider may show afterwards."
			>
				<WizardRow>
					<WizardField field="ipOwnershipMode" label="Intellectual property">
						{({ id, describedBy, status }) => (
							<Select
								id={id}
								aria-describedby={describedBy}
								options={IP_OPTIONS}
								value={draft.ipOwnershipMode}
								onValueChange={(next: string) =>
									patchDraft({ ipOwnershipMode: next as IpOwnershipMode })}
								status={status}
								fluid
								aria-label="Intellectual property"
							/>
						)}
					</WizardField>

					<WizardField
						field="portfolioDisplayRights"
						label="Portfolio rights"
						hint="Whether the provider may show this work publicly."
					>
						{({ id, describedBy, status }) => (
							<Select
								id={id}
								aria-describedby={describedBy}
								options={PORTFOLIO_OPTIONS}
								value={draft.portfolioDisplayRights}
								onValueChange={(next: string) =>
									patchDraft({ portfolioDisplayRights: next as PortfolioDisplayRights })}
								status={status}
								fluid
								aria-label="Portfolio rights"
							/>
						)}
					</WizardField>
				</WizardRow>
			</WizardGroup>

			<WizardGroup title="Confidentiality" hint={NDA_HINT[draft.ndaMode]}>
				<WizardField field="ndaMode" label="NDA">
					{({ id, describedBy, status }) => (
						<Select
							id={id}
							aria-describedby={describedBy}
							options={NDA_OPTIONS}
							value={draft.ndaMode}
							onValueChange={(next: string) => setNdaMode(next as NdaMode)}
							status={status}
							fluid
							aria-label="NDA"
						/>
					)}
				</WizardField>

				{draft.ndaMode === "custom" && (
					<WizardBlock
						label="Your NDA"
						hint="A PDF or Word document. Everyone joining the engagement accepts it."
					>
						<AttachmentField
							ids={draft.ndaDocumentId === null ? [] : [draft.ndaDocumentId]}
							onChange={(ids) => patchDraft({ ndaDocumentId: ids[0] ?? null })}
							ownerId={props.ownerId}
							max={1}
							accept=".pdf,.doc,.docx,.rtf,.txt"
							label="Attach NDA"
						/>
					</WizardBlock>
				)}
			</WizardGroup>

			<WizardGroup
				title="Screening"
				hint="Leave either list empty to accept anyone — an empty list is an answer, not a gap."
			>
				<WizardRow>
					<WizardField
						field="languages"
						label="Languages"
						hint="A provider must be able to work in one of these."
					>
						{({ id, describedBy, status }) => (
							<Chips
								id={id}
								aria-describedby={describedBy}
								value={draft.languages}
								onValueChange={(languages: string[]) => patchDraft({ languages })}
								placeholder="Add a language…"
								max={20}
								addOnBlur
								status={status}
								fluid
								aria-label="Languages"
							/>
						)}
					</WizardField>

					<WizardField
						field="locations"
						label="Locations"
						hint="Where a provider must be based."
					>
						{({ id, describedBy, status }) => (
							<Chips
								id={id}
								aria-describedby={describedBy}
								value={draft.locations}
								onValueChange={(locations: string[]) => patchDraft({ locations })}
								placeholder="Add a country or city…"
								max={20}
								addOnBlur
								status={status}
								fluid
								aria-label="Locations"
							/>
						)}
					</WizardField>
				</WizardRow>
			</WizardGroup>

			<WizardNote>
				These terms govern the whole engagement. A stage may tighten confidentiality on step 3;
				nothing here can be loosened per stage.
			</WizardNote>
		</>
	);
}
