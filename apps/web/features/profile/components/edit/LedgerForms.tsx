import type { JSX } from "preact";
import { Checkbox, FormControl, Textarea } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { CertificationEdit, EducationEdit, ExperienceEdit } from "@projective/types/profile";
import type { LedgerDraft } from "../../core/owner-experience.ts";
import { Field } from "./ListEditors.tsx";

/**
 * LedgerForms — the fields of one Experience-section row (a role, a qualification, a certification),
 * shared by the row's inline editor and the Add dialog so both ask the same questions in the same
 * order. `errors` is keyed by the row's own field names (`owner-experience.ts` `rowErrors`).
 */
export interface LedgerFieldsProps<T> {
	row: T;
	errors: Readonly<Record<string, string>>;
	update: (patch: Partial<T>) => void;
}

/** A role. */
export function ExperienceFields(
	{ row, errors, update }: LedgerFieldsProps<ExperienceEdit>,
): JSX.Element {
	return (
		<div class="pf-rows__grid">
			<Field
				label="Role"
				required
				value={row.role}
				maxLength={120}
				error={errors.role}
				onValue={(v) => update({ role: v })}
			/>
			<Field
				label="Company or client"
				required
				value={row.orgName}
				maxLength={120}
				error={errors.orgName}
				onValue={(v) => update({ orgName: v })}
			/>
			<Field
				label="From (year)"
				required
				value={row.startYear}
				maxLength={4}
				placeholder="2019"
				error={errors.startYear}
				onValue={(v) => update({ startYear: v.trim() })}
			/>
			{!row.isCurrent && (
				<Field
					label="To (year)"
					value={row.endYear ?? ""}
					maxLength={4}
					placeholder="2023"
					error={errors.endYear}
					onValue={(v) => update({ endYear: v.trim() || null })}
				/>
			)}
			<Checkbox
				class="pf-rows__check"
				value={row.isCurrent}
				label="I work here now"
				onValueChange={(v) => update({ isCurrent: v, endYear: v ? null : row.endYear })}
			/>
			<FormControl label="What you did" class="pf-rows__wide" error={errors.summary} collapseHint>
				{({ id, describedBy }) => (
					<Textarea
						id={id}
						aria-describedby={describedBy}
						value={row.summary}
						maxLength={600}
						rows={3}
						autoResize
						fluid
						size="sm"
						onValueChange={(v) => update({ summary: v })}
					/>
				)}
			</FormControl>
		</div>
	);
}

/** A qualification. */
export function EducationFields(
	{ row, errors, update }: LedgerFieldsProps<EducationEdit>,
): JSX.Element {
	return (
		<div class="pf-rows__grid">
			<Field
				label="School"
				required
				value={row.school}
				maxLength={120}
				error={errors.school}
				onValue={(v) => update({ school: v })}
			/>
			<Field
				label="Qualification"
				required
				value={row.credential}
				maxLength={80}
				placeholder="BSc, Diploma…"
				error={errors.credential}
				onValue={(v) => update({ credential: v })}
			/>
			<Field
				label="Field of study"
				value={row.field}
				maxLength={120}
				error={errors.field}
				onValue={(v) => update({ field: v })}
			/>
			<Field
				label="From (year)"
				required
				value={row.startYear}
				maxLength={4}
				error={errors.startYear}
				onValue={(v) => update({ startYear: v.trim() })}
			/>
			<Field
				label="To (year)"
				value={row.endYear ?? ""}
				maxLength={4}
				error={errors.endYear}
				onValue={(v) => update({ endYear: v.trim() || null })}
			/>
		</div>
	);
}

/** A certification. Its verified mark is the platform's, shown and never edited. */
export function CertificationFields(
	{ row, errors, update }: LedgerFieldsProps<CertificationEdit>,
): JSX.Element {
	return (
		<div class="pf-rows__grid">
			<Field
				label="Certification"
				required
				value={row.name}
				maxLength={120}
				error={errors.name}
				onValue={(v) => update({ name: v })}
			/>
			<Field
				label="Issued by"
				required
				value={row.issuer}
				maxLength={120}
				error={errors.issuer}
				onValue={(v) => update({ issuer: v })}
			/>
			<Field
				label="Issued (year)"
				required
				value={row.issuedYear}
				maxLength={4}
				error={errors.issuedYear}
				onValue={(v) => update({ issuedYear: v.trim() })}
			/>
			<Field
				label="Expires (year)"
				value={row.expiresYear ?? ""}
				maxLength={4}
				error={errors.expiresYear}
				onValue={(v) => update({ expiresYear: v.trim() || null })}
			/>
			<Field
				label="Credential link"
				value={row.credentialUrl ?? ""}
				maxLength={500}
				placeholder="https://…"
				class="pf-rows__wide"
				error={errors.credentialUrl}
				onValue={(v) => update({ credentialUrl: v.trim() || null })}
			/>
			{row.verified && (
				<p class="pf-rows__verified">
					<Icon name="seal-check" size="xs" filled aria-hidden />{" "}
					Verified by Projective. Changing the name or issuer removes this until it's checked again.
				</p>
			)}
		</div>
	);
}

/** The fields for the draft's ledger; every change hands back the whole draft. */
export function LedgerDraftFields(
	{ draft, errors, onChange }: {
		draft: LedgerDraft;
		errors: Readonly<Record<string, string>>;
		onChange: (next: LedgerDraft) => void;
	},
): JSX.Element {
	switch (draft.ledger) {
		case "experience":
			return (
				<ExperienceFields
					row={draft.row}
					errors={errors}
					update={(patch) => onChange({ ledger: "experience", row: { ...draft.row, ...patch } })}
				/>
			);
		case "education":
			return (
				<EducationFields
					row={draft.row}
					errors={errors}
					update={(patch) => onChange({ ledger: "education", row: { ...draft.row, ...patch } })}
				/>
			);
		case "certifications":
			return (
				<CertificationFields
					row={draft.row}
					errors={errors}
					update={(patch) =>
						onChange({ ledger: "certifications", row: { ...draft.row, ...patch } })}
				/>
			);
	}
}
