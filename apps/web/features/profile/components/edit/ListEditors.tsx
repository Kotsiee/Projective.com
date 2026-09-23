import type { ComponentChildren, JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { Button, Checkbox, FormControl, InputText, Select, Textarea } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type {
	CertificationEdit,
	EducationEdit,
	ExperienceEdit,
	LanguageEdit,
	LanguageLevel,
} from "@projective/types/profile";
import { errorFor, type Keyed, newKey } from "../../core/edit-model.ts";

/**
 * ListEditors — the owner editor's repeating sections: languages, roles, education and
 * certifications. Each row edits in place; rows can be added, removed and moved. The parent owns the
 * list (it is part of the page's one draft) — these components only render it and report changes.
 *
 * Rows are keyed by their client `key`, so a row's inputs stay attached to it while others move or
 * disappear. Every control is labelled, every icon-only action carries a portal `Tooltip` and an
 * `aria-label` (§B.6), and a refusal for a row (from the form's own check or the server's) is shown
 * under the field it names, or under the row when the server names only the row.
 */

// #region Shared row chrome

interface RowListProps<T> {
	rows: Keyed<T>[];
	onChange: (rows: Keyed<T>[]) => void;
	/** The noun for accessible names ("role", "language"). */
	noun: string;
	/** Rows allowed at most. */
	max: number;
	/** A new blank row. */
	blank: () => T;
	addLabel: string;
	renderRow: (row: Keyed<T>, index: number, update: (patch: Partial<T>) => void) => ComponentChildren;
	empty: string;
}

function move<T>(rows: T[], from: number, to: number): T[] {
	if (to < 0 || to >= rows.length) return rows;
	const next = [...rows];
	const [row] = next.splice(from, 1);
	next.splice(to, 0, row);
	return next;
}

function RowList<T>(props: RowListProps<T>): JSX.Element {
	const { rows, onChange, noun, max } = props;
	return (
		<div class="pf-rows">
			{rows.length === 0 && <p class="pf-edit__hint">{props.empty}</p>}
			<ol class="pf-rows__list" role="list">
				{rows.map((row, index) => {
					const update = (patch: Partial<T>) =>
						onChange(rows.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
					return (
						<li key={row.key} class="pf-rows__row">
							<div class="pf-rows__fields">{props.renderRow(row, index, update)}</div>
							<div class="pf-rows__actions">
								<Tooltip content="Move up" placement="top">
									<Button
										size="sm"
										variant="text"
										iconOnly
										class="pf-edit__ghost"
										aria-label={`Move ${noun} ${index + 1} up`}
										disabled={index === 0}
										icon={<Icon name="arrow-up" size="sm" />}
										onClick={() => onChange(move(rows, index, index - 1))}
									/>
								</Tooltip>
								<Tooltip content="Move down" placement="top">
									<Button
										size="sm"
										variant="text"
										iconOnly
										class="pf-edit__ghost"
										aria-label={`Move ${noun} ${index + 1} down`}
										disabled={index === rows.length - 1}
										icon={<Icon name="arrow-down" size="sm" />}
										onClick={() => onChange(move(rows, index, index + 1))}
									/>
								</Tooltip>
								<Tooltip content="Remove" placement="top">
									<Button
										size="sm"
										variant="text"
										iconOnly
										class="pf-edit__ghost"
										aria-label={`Remove ${noun} ${index + 1}`}
										icon={<Icon name="trash" size="sm" />}
										onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
									/>
								</Tooltip>
							</div>
						</li>
					);
				})}
			</ol>
			{rows.length < max && (
				<Button
					size="sm"
					variant="outlined"
					class="pf-edit__btn"
					icon={<Icon name="plus" size="sm" />}
					onClick={() => onChange([...rows, { ...props.blank(), key: newKey() }])}
				>
					{props.addLabel}
				</Button>
			)}
		</div>
	);
}

/** A labelled text field bound to one row value. */
function Field(
	props: {
		label: string;
		value: string;
		onValue: (v: string) => void;
		error?: string;
		maxLength?: number;
		placeholder?: string;
		required?: boolean;
		class?: string;
	},
): JSX.Element {
	return (
		<FormControl
			label={props.label}
			error={props.error}
			status={props.error ? "invalid" : "default"}
			required={props.required}
			class={props.class}
		>
			{({ id, describedBy, status, required }) => (
				<InputText
					id={id}
					aria-describedby={describedBy}
					status={status}
					required={required}
					value={props.value}
					maxLength={props.maxLength}
					placeholder={props.placeholder}
					fluid
					size="sm"
					onValueChange={props.onValue}
				/>
			)}
		</FormControl>
	);
}

// #endregion

// #region Languages

const LEVELS: ReadonlyArray<{ label: string; value: LanguageLevel }> = [
	{ label: "Native", value: "native" },
	{ label: "Fluent", value: "fluent" },
	{ label: "Professional", value: "professional" },
	{ label: "Conversational", value: "conversational" },
	{ label: "Basic", value: "basic" },
];

/** The languages offered — common ISO 639-1 codes, named in English by the platform's `Intl`. */
const LANGUAGE_CODES = [
	"en", "es", "fr", "de", "it", "pt", "nl", "sv", "no", "da", "fi", "pl", "cs", "el", "tr", "ru",
	"uk", "ro", "hu", "ar", "he", "fa", "ur", "hi", "bn", "pa", "ta", "te", "ml", "mr", "gu", "zh",
	"ja", "ko", "vi", "th", "id", "ms", "tl", "sw", "am", "yo", "ha", "zu",
];

const LANGUAGE_NAMES = (() => {
	try {
		return new Intl.DisplayNames(["en"], { type: "language" });
	} catch {
		return null;
	}
})();

function languageName(code: string): string {
	try {
		return LANGUAGE_NAMES?.of(code.toLowerCase()) ?? code.toUpperCase();
	} catch {
		return code.toUpperCase();
	}
}

const LANGUAGE_OPTIONS = LANGUAGE_CODES
	.map((code) => ({ label: languageName(code), value: code.toUpperCase() }))
	.sort((a, b) => a.label.localeCompare(b.label));

export function LanguagesEditor(
	{ rows, onChange, errors }: {
		rows: Keyed<LanguageEdit>[];
		onChange: (rows: Keyed<LanguageEdit>[]) => void;
		errors: Record<string, string>;
	},
): JSX.Element {
	return (
		<RowList
			rows={rows}
			onChange={onChange}
			noun="language"
			max={12}
			addLabel="Add a language"
			empty="No languages yet."
			blank={() => ({ code: "", level: "professional" as LanguageLevel })}
			renderRow={(row, i, update) => {
				// A saved code outside the offered list still shows (and saves) as itself.
				const options = LANGUAGE_OPTIONS.some((o) => o.value === row.code) || !row.code
					? LANGUAGE_OPTIONS
					: [{ label: languageName(row.code), value: row.code }, ...LANGUAGE_OPTIONS];
				return (
					<div class="pf-rows__grid pf-rows__grid--pair">
						<FormControl
							label="Language"
							error={errorFor(errors, `languages.${i}.code`)}
							status={errorFor(errors, `languages.${i}.code`) ? "invalid" : "default"}
						>
							{({ id, describedBy, status }) => (
								<Select
									id={id}
									aria-describedby={describedBy}
									status={status}
									options={options}
									value={row.code}
									filter
									placeholder="Choose a language"
									fluid
									size="sm"
									onValueChange={(v) => update({ code: v })}
								/>
							)}
						</FormControl>
						<FormControl label="Proficiency">
							{({ id }) => (
								<Select
									id={id}
									options={LEVELS as unknown as Array<{ label: string; value: string }>}
									value={row.level}
									fluid
									size="sm"
									onValueChange={(v) => update({ level: v as LanguageLevel })}
								/>
							)}
						</FormControl>
					</div>
				);
			}}
		/>
	);
}

// #endregion

// #region Experience

export function ExperienceEditor(
	{ rows, onChange, errors }: {
		rows: Keyed<ExperienceEdit>[];
		onChange: (rows: Keyed<ExperienceEdit>[]) => void;
		errors: Record<string, string>;
	},
): JSX.Element {
	return (
		<RowList
			rows={rows}
			onChange={onChange}
			noun="role"
			max={30}
			addLabel="Add a role"
			empty="No roles yet."
			blank={() => ({
				orgName: "",
				role: "",
				startYear: "",
				endYear: null,
				isCurrent: false,
				summary: "",
			})}
			renderRow={(row, i, update) => (
				<div class="pf-rows__grid">
					<Field
						label="Role"
						required
						value={row.role}
						maxLength={120}
						error={errorFor(errors, `experience.${i}.role`)}
						onValue={(v) => update({ role: v })}
					/>
					<Field
						label="Organisation"
						required
						value={row.orgName}
						maxLength={120}
						error={errorFor(errors, `experience.${i}.orgName`)}
						onValue={(v) => update({ orgName: v })}
					/>
					<Field
						label="From (year)"
						required
						value={row.startYear}
						maxLength={4}
						placeholder="2019"
						error={errorFor(errors, `experience.${i}.startYear`)}
						onValue={(v) => update({ startYear: v.trim() })}
					/>
					{!row.isCurrent && (
						<Field
							label="To (year)"
							value={row.endYear ?? ""}
							maxLength={4}
							placeholder="2023"
							error={errorFor(errors, `experience.${i}.endYear`)}
							onValue={(v) => update({ endYear: v.trim() || null })}
						/>
					)}
					<Checkbox
						class="pf-rows__check"
						value={row.isCurrent}
						label="I work here now"
						onValueChange={(v) => update({ isCurrent: v, endYear: v ? null : row.endYear })}
					/>
					<FormControl label="What you did" class="pf-rows__wide" collapseHint>
						{({ id }) => (
							<Textarea
								id={id}
								value={row.summary}
								maxLength={600}
								rows={2}
								autoResize
								fluid
								size="sm"
								onValueChange={(v) => update({ summary: v })}
							/>
						)}
					</FormControl>
				</div>
			)}
		/>
	);
}

// #endregion

// #region Education

export function EducationEditor(
	{ rows, onChange, errors }: {
		rows: Keyed<EducationEdit>[];
		onChange: (rows: Keyed<EducationEdit>[]) => void;
		errors: Record<string, string>;
	},
): JSX.Element {
	return (
		<RowList
			rows={rows}
			onChange={onChange}
			noun="school"
			max={20}
			addLabel="Add education"
			empty="No education yet."
			blank={() => ({ school: "", credential: "", field: "", startYear: "", endYear: null })}
			renderRow={(row, i, update) => (
				<div class="pf-rows__grid">
					<Field
						label="School"
						required
						value={row.school}
						maxLength={120}
						error={errorFor(errors, `education.${i}.school`)}
						onValue={(v) => update({ school: v })}
					/>
					<Field
						label="Qualification"
						required
						value={row.credential}
						maxLength={80}
						placeholder="BSc, Diploma…"
						error={errorFor(errors, `education.${i}.credential`)}
						onValue={(v) => update({ credential: v })}
					/>
					<Field
						label="Field of study"
						value={row.field}
						maxLength={120}
						error={errorFor(errors, `education.${i}.field`)}
						onValue={(v) => update({ field: v })}
					/>
					<Field
						label="From (year)"
						required
						value={row.startYear}
						maxLength={4}
						error={errorFor(errors, `education.${i}.startYear`)}
						onValue={(v) => update({ startYear: v.trim() })}
					/>
					<Field
						label="To (year)"
						value={row.endYear ?? ""}
						maxLength={4}
						error={errorFor(errors, `education.${i}.endYear`)}
						onValue={(v) => update({ endYear: v.trim() || null })}
					/>
				</div>
			)}
		/>
	);
}

// #endregion

// #region Certifications

export function CertificationsEditor(
	{ rows, onChange, errors }: {
		rows: Keyed<CertificationEdit>[];
		onChange: (rows: Keyed<CertificationEdit>[]) => void;
		errors: Record<string, string>;
	},
): JSX.Element {
	return (
		<RowList
			rows={rows}
			onChange={onChange}
			noun="certification"
			max={20}
			addLabel="Add a certification"
			empty="No certifications yet."
			blank={() => ({
				name: "",
				issuer: "",
				issuedYear: "",
				expiresYear: null,
				credentialUrl: null,
				verified: false,
			})}
			renderRow={(row, i, update) => (
				<div class="pf-rows__grid">
					<Field
						label="Certification"
						required
						value={row.name}
						maxLength={120}
						error={errorFor(errors, `certifications.${i}.name`)}
						onValue={(v) => update({ name: v })}
					/>
					<Field
						label="Issued by"
						required
						value={row.issuer}
						maxLength={120}
						error={errorFor(errors, `certifications.${i}.issuer`)}
						onValue={(v) => update({ issuer: v })}
					/>
					<Field
						label="Issued (year)"
						required
						value={row.issuedYear}
						maxLength={4}
						error={errorFor(errors, `certifications.${i}.issuedYear`)}
						onValue={(v) => update({ issuedYear: v.trim() })}
					/>
					<Field
						label="Expires (year)"
						value={row.expiresYear ?? ""}
						maxLength={4}
						error={errorFor(errors, `certifications.${i}.expiresYear`)}
						onValue={(v) => update({ expiresYear: v.trim() || null })}
					/>
					<Field
						label="Credential link"
						value={row.credentialUrl ?? ""}
						maxLength={500}
						placeholder="https://…"
						class="pf-rows__wide"
						error={errorFor(errors, `certifications.${i}.credentialUrl`)}
						onValue={(v) => update({ credentialUrl: v.trim() || null })}
					/>
					{row.verified && (
						<p class="pf-rows__verified">
							<Icon name="verified" size="xs" filled aria-hidden /> Verified by Projective — editing the
							name or issuer removes this until it's checked again.
						</p>
					)}
				</div>
			)}
		/>
	);
}

// #endregion
