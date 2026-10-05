import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Checkbox, MultiSelect, Select, SelectButton, ToggleSwitch } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import AssetPicker from "@web/features/files/islands/AssetPicker.island.tsx";
import { openPicker } from "@web/features/files/core/files-state.ts";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import { timelinePresetApplies } from "../../types/projects-types.ts";
import type {
	IpOwnershipMode,
	NdaDocumentSource,
	PortfolioDisplayRights,
	ProjectSetup,
	ProjectVisibility,
	TimelinePreset,
} from "../../types/projects-types.ts";
import { patchSetup } from "../../core/setup-state.ts";
import { useAttachmentUpload } from "../../hooks/useAttachmentUpload.ts";
import { Disclosure, Field, Note, PairRow, Section } from "./setup-primitives.tsx";
import {
	CURRENCY_OPTIONS,
	DEADLINE_BONUS_PERCENT,
	IP_LABEL,
	LANGUAGE_OPTIONS,
	LOCATION_OPTIONS,
	optionsOf,
	PORTFOLIO_LABEL,
	TIMELINE_LABEL,
	VISIBILITY_LABEL,
} from "./setup-format.ts";
import { DropZone, NDA_PICKER, PendingFileRow } from "./SetupAttachmentsSection.tsx";

/**
 * SetupLegalSection — the terms a freelancer agrees to: visibility on publish, the timeline preset,
 * location and language gates, and under Advanced options the NDA, the currency, ownership of the work,
 * portfolio rights and the deadline-bonus rule.
 */

// #region NDA
/**
 * The confidentiality term the engagement is offered under.
 *
 * Lives inside Rules → Advanced options, with the other things a freelancer agrees to and the owner
 * sets once. It was previously filed beside the reference attachments because both hold a file
 * reference — which is a similarity of STORAGE, not of subject, and it produced a section whose
 * title had to name two things.
 *
 * The three states of the source are deliberate: the platform standard needs no upload and no legal
 * review and is what most engagements want; a custom document is a real choice with a real
 * obligation attached, which is why choosing it and not attaching one is called out as a publish
 * blocker rather than left to be discovered at the gate.
 */
function NdaFields({ setup }: { setup: ProjectSetup }): JSX.Element {
	const rules = setup.rules;

	/**
	 * The custom document's filename, for as long as this session knows it.
	 *
	 * `ProjectRules` stores only the asset id, so a reload has nothing else to show and the row falls
	 * back to it. That is worse than a name and better than a lie — the alternative, a generic
	 * "Uploaded document", would hide which of several documents is actually in force.
	 */
	const documentName = useSignal<string | null>(null);

	const attachDocument = (id: string, name: string | null) => {
		documentName.value = name;
		patchSetup({ rules: { ndaDocumentId: id } });
	};

	const uploads = useAttachmentUpload({
		// One document, and only while there is not one already.
		room: () => (rules.ndaDocumentId ? 0 : 1),
		onLanded: (assets) => {
			const doc = assets[0];
			if (doc) attachDocument(doc.id, doc.name);
		},
	});

	const pending = uploads.pending.value;
	const held = rules.ndaDocumentId !== null;

	const onFileInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
		const picked = event.currentTarget.files;
		if (picked && picked.length > 0) uploads.send([picked[0]]);
		event.currentTarget.value = "";
	};

	return (
		<>
			<div class="psu-toggles">
				<Checkbox
					value={rules.ndaRequired}
					onValueChange={(ndaRequired: boolean) => patchSetup({ rules: { ndaRequired } })}
					label="Require an NDA before work begins"
				/>
			</div>

			{rules.ndaRequired && (
				<>
					<Field
						label="Which NDA"
						hint="The platform's standard mutual NDA needs no upload and no legal review."
					>
						<SelectButton
							options={[
								{ value: "platform", label: "Projective standard" },
								{ value: "custom", label: "Your own document" },
							]}
							value={rules.ndaSource}
							onValueChange={(v: string | string[]) =>
								patchSetup({
									rules: {
										ndaSource: v as NdaDocumentSource,
										// Dropping the reference when the source goes back to the platform standard:
										// leaving it behind would keep a document id nothing points at, which reads
										// on the next open as a custom NDA that is not in force.
										ndaDocumentId: v === "custom" ? rules.ndaDocumentId : null,
									},
								})}
							aria-label="Which NDA"
						/>
					</Field>

					{rules.ndaSource === "custom" && (
						<Field
							label="NDA document"
							hint="Freelancers sign this before they can see the stage they are applying to."
						>
							{
								/*
								 * Its own drop zone, independent of the attachments one.
								 *
								 * Both light up together when a drag enters the page, which is the whole reason
								 * this is a second zone rather than one shared target: an owner with the NDA in
								 * their hand and Advanced options open can put it where it belongs in one gesture,
								 * instead of dropping it into the reference pack and then moving it.
								 *
								 * When Advanced options is CLOSED this subtree is not rendered at all — a
								 * `<details>` body is `display: none` — so "only the attachments zone highlights"
								 * is true by construction rather than by a rule somebody has to remember to keep.
								 */
							}
							<DropZone label="your NDA" disabled={held} onFiles={uploads.send}>
								{held && (
									<div class="psu-file">
										<span class="psu-file__thumb">
											<Icon name="document" size="sm" />
										</span>
										<span class="psu-file__body">
											<span class="psu-file__name">
												{documentName.value ?? rules.ndaDocumentId}
											</span>
										</span>
										<button
											type="button"
											class="psu-stage__remove"
											aria-label="Remove the NDA document"
											onClick={() => {
												documentName.value = null;
												patchSetup({ rules: { ndaDocumentId: null } });
											}}
										>
											<Icon name="trash" />
										</button>
									</div>
								)}

								{
									/*
									 * One list around the rows, not one per row. `PendingFileRow` renders an `<li>`,
									 * so it has to have a list parent — but a `<ul>` per item would announce "list of
									 * 1" once per file, which is the sort of markup that reads correctly on screen
									 * and wrongly to anything that follows structure.
									 */
								}
								{pending.length > 0 && (
									<ul class="psu-rows" role="list" aria-busy={uploads.busy.value || undefined}>
										{pending.map((row) => (
											<PendingFileRow
												key={row.key}
												row={row}
												onDismiss={() => uploads.dismiss(row.key)}
											/>
										))}
									</ul>
								)}

								{!held && (
									<div class="psu-actions" data-scale={pending.length > 0 ? "compact" : "lead"}>
										<button
											type="button"
											class="psu-add"
											onClick={() =>
												openPicker({
													requesterId: NDA_PICKER,
													title: "Choose your NDA",
													kinds: ["pdf", "doc"],
													multiple: false,
												})}
										>
											<Icon name="document" />
											Choose a document
										</button>
										<label class="psu-add">
											<Icon name="upload" />
											Upload
											<input
												type="file"
												class="psu-visually-hidden"
												accept=".pdf,.doc,.docx,application/pdf"
												onChange={onFileInput}
											/>
										</label>
									</div>
								)}
							</DropZone>

							{!held && (
								<Note>
									You have chosen your own NDA and not attached it yet — the engagement cannot be
									published until you do.
								</Note>
							)}
						</Field>
					)}

					<AssetPicker
						requesterId={NDA_PICKER}
						onPick={(assets: AssetItem[]) => {
							const doc = assets[0];
							if (doc) attachDocument(doc.id, doc.name);
						}}
					/>
				</>
			)}
		</>
	);
}
// #endregion

// #region Terms & visibility
/**
 * The terms the engagement is offered under — every one of them a term a freelancer agrees to.
 *
 * Visibility governs TWO facts that a single dropdown would conflate, so the control is scoped to
 * one of them and the note carries the other — and each reads its own field rather than inferring
 * the second from the first. `rules.visibility` is the intent ON PUBLISH, stored on its own column;
 * `setup.liveVisibility` is where the row sits today, derived server-side from the status.
 *
 * Scoping it this way is what keeps the label honest. A dropdown labelled plain "Visibility" showing
 * `public` over a row that is unlisted would be stating something false; the same dropdown showing
 * `unlisted` would hide the decision the owner actually needs to make before publishing. Naming the
 * control for the moment it takes effect lets it show a real stored value and still answer the
 * question the owner is actually asking.
 *
 * The note reads `liveVisibility` rather than re-deriving "draft implies unlisted" from the status.
 * The two agree on every row this surface writes — the update path converges them on every save —
 * but a second derivation here could disagree with the server's on a row written before the intent
 * column existed, and the failure mode of that disagreement is telling an owner their project is
 * hidden while it is on Explore.
 */
export function RulesSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const rules = setup.rules;
	const isDraft = setup.status === "draft";
	const hidden = setup.liveVisibility !== "public";
	const deferred = isDraft || setup.liveVisibility !== rules.visibility;
	/*
	 * The Timeline preset describes how the STAGES run against one another, so on an engagement that
	 * does not break into stages — a one-off without milestones — it is ABSENT rather than disabled.
	 * Absence is for a capability that does not exist here; a greyed dropdown would advertise a
	 * sequence the work does not have (the same rule the deadline-bonus toggle below follows).
	 */
	const timed = timelinePresetApplies(setup.structure);

	return (
		<Section sectionKey="rules" title="Terms & visibility" hint={hint}>
			<PairRow paired={timed}>
				<Field
					label="Visibility on publish"
					hint={deferred
						? "This is what applies the moment you publish."
						: "Live now — changes here take effect immediately."}
				>
					<Select
						options={optionsOf(VISIBILITY_LABEL)}
						value={rules.visibility}
						onValueChange={(v: string) =>
							patchSetup({ rules: { visibility: v as ProjectVisibility } })}
						aria-label="Visibility on publish"
					/>
				</Field>
				{timed && (
					<Field label="Timeline">
						<Select
							options={optionsOf(TIMELINE_LABEL)}
							value={rules.timelinePreset}
							onValueChange={(v: string) =>
								patchSetup({ rules: { timelinePreset: v as TimelinePreset } })}
							aria-label="Timeline"
						/>
					</Field>
				)}
			</PairRow>

			{deferred && (
				<Note>
					{hidden
						? `Right now this project is ${
							VISIBILITY_LABEL[setup.liveVisibility].toLowerCase()
						}, so nothing half-written reaches Explore.`
						: "Right now this project is public."} {isDraft
						? "It stays that way until you publish it."
						: "The setting above applies once its status changes."}
				</Note>
			)}

			<div class="psu-row">
				<Field label="Locations" hint="Leave empty to accept freelancers anywhere.">
					<MultiSelect
						options={LOCATION_OPTIONS}
						value={rules.locationRestriction}
						onValueChange={(locationRestriction: string[]) =>
							patchSetup({ rules: { locationRestriction } })}
						placeholder="Anywhere"
						filter
						grouping
						showClear
						aria-label="Locations"
					/>
				</Field>
				<Field label="Languages" hint="Leave empty to accept any language.">
					<MultiSelect
						options={LANGUAGE_OPTIONS}
						value={rules.languageRequirement}
						onValueChange={(languageRequirement: string[]) =>
							patchSetup({ rules: { languageRequirement } })}
						placeholder="Any language"
						filter
						showClear
						aria-label="Languages"
					/>
				</Field>
			</div>

			{
				/*
				 * Everything below is set once and rarely revisited — the money's unit, who ends up owning
				 * the work, whether it can be shown, and the bonus rule. They are all real terms a
				 * freelancer agrees to, so none of them is dropped; they are simply not in the reading path
				 * of a form somebody fills in from the top every time.
				 *
				 * Visibility, timeline, locations and languages deliberately stay ABOVE this fold: they are
				 * publication and matching terms that decide who ever sees the engagement, which is a
				 * decision the owner is making right now rather than a default they inherited.
				 *
				 * The NDA joins them here, moved out of the attachments section. It is a term a freelancer
				 * agrees to — the same category as ownership of the work and portfolio rights, which are
				 * its immediate neighbours — and it was only ever filed beside the reference files because
				 * both happen to hold an asset id.
				 */
			}
			<Disclosure label="Advanced options">
				<NdaFields setup={setup} />

				<Field
					label="Currency"
					hint="Every figure on this page is priced in it. Changing it relabels those figures; it does not convert them."
				>
					<Select
						options={CURRENCY_OPTIONS}
						value={setup.budget.currency}
						onValueChange={(next: string) => patchSetup({ budget: { currency: next } })}
						filter
						aria-label="Currency"
					/>
				</Field>

				<div class="psu-row">
					<Field label="Ownership of the work">
						<Select
							options={optionsOf(IP_LABEL)}
							value={rules.ipOwnershipMode}
							onValueChange={(v: string) =>
								patchSetup({ rules: { ipOwnershipMode: v as IpOwnershipMode } })}
							aria-label="Ownership of the work"
						/>
					</Field>
					<Field label="Portfolio rights">
						<Select
							options={optionsOf(PORTFOLIO_LABEL)}
							value={rules.portfolioDisplayRights}
							onValueChange={(v: string) =>
								patchSetup({ rules: { portfolioDisplayRights: v as PortfolioDisplayRights } })}
							aria-label="Portfolio rights"
						/>
					</Field>
				</div>

				{
					/*
					 * A deadline bonus is paid per TICKET, and only a pipeline has tickets. On every other
					 * format the control is ABSENT rather than disabled: absence is for a capability that does
					 * not exist here, and a greyed switch would advertise one that does.
					 */
				}
				{setup.format === "pipeline" && (
					<div class="psu-toggles">
						<ToggleSwitch
							value={rules.allowDeadlineBonuses}
							onValueChange={(allowDeadlineBonuses: boolean) =>
								patchSetup({ rules: { allowDeadlineBonuses } })}
							label="Allow deadline bonuses on tickets"
						/>
						<Note>
							A freelancer who delivers a ticket ahead of its due date earns an extra{" "}
							{DEADLINE_BONUS_PERCENT}% of its price. Pipelines only — a one-off has one deadline,
							which is the delivery itself.
						</Note>
					</div>
				)}
			</Disclosure>
		</Section>
	);
}
// #endregion
