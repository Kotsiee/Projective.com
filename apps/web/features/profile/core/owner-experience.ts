import type {
	CertificationEdit,
	CertificationEntry,
	EducationEdit,
	EducationEntry,
	ExperienceEdit,
	ExperienceEntry,
	ProfileEditModel,
	ProfileSavePatch,
	ProfileTabPayload,
} from "@projective/types/profile";
import { blockPatch, draftOf, type Keyed, newKey } from "./edit-model.ts";

/**
 * owner-experience — the pure half of the owner's Experience section on `/[handle]/experience`
 * (Decision #439): the rows a visitor would read, drawn from the model as STORED (so a save shows at
 * once, with no second read), and the whole-list patch one row's edit, addition or removal sends to
 * `org.save_profile`.
 */

/** The three ledgers. */
export type Ledger = "experience" | "education" | "certifications";

/** One row being edited or added, with the ledger it belongs to. */
export type LedgerDraft =
	| { ledger: "experience"; row: ExperienceEdit }
	| { ledger: "education"; row: EducationEdit }
	| { ledger: "certifications"; row: CertificationEdit };

/** The visitor's rows, from the stored model. */
export interface LedgerEntries {
	experience: ExperienceEntry[];
	education: EducationEntry[];
	certifications: CertificationEntry[];
}

/** The logos the public read resolved, by row id — the model carries none. */
export function logosOf(
	payload: Pick<ProfileTabPayload, Ledger> | null | undefined,
): Map<string, string> {
	const out = new Map<string, string>();
	for (const row of payload?.experience ?? []) if (row.logo) out.set(row.id, row.logo);
	for (const row of payload?.education ?? []) if (row.logo) out.set(row.id, row.logo);
	for (const row of payload?.certifications ?? []) if (row.logo) out.set(row.id, row.logo);
	return out;
}

/** The rows a visitor would read, mapped from the stored model; a row without an id is not stored yet. */
export function entriesOf(
	model: ProfileEditModel,
	logos: ReadonlyMap<string, string>,
): LedgerEntries {
	return {
		experience: model.experience.flatMap((e) =>
			e.id
				? [{
					id: e.id,
					org: e.orgName,
					role: e.role,
					start: e.startYear,
					end: e.isCurrent ? undefined : e.endYear ?? undefined,
					current: e.isCurrent,
					summary: e.summary,
					logo: logos.get(e.id),
				}]
				: []
		),
		education: model.education.flatMap((d) =>
			d.id
				? [{
					id: d.id,
					school: d.school,
					credential: d.credential,
					field: d.field,
					start: d.startYear,
					end: d.endYear ?? undefined,
					logo: logos.get(d.id),
				}]
				: []
		),
		certifications: model.certifications.flatMap((c) =>
			c.id
				? [{
					id: c.id,
					name: c.name,
					issuer: c.issuer,
					issued: c.issuedYear,
					expires: c.expiresYear ?? undefined,
					verified: c.verified === true,
					credentialUrl: c.credentialUrl ?? undefined,
					logo: logos.get(c.id),
				}]
				: []
		),
	};
}

/** A blank row for the Add dialog. */
export function blankDraft(ledger: Ledger): LedgerDraft {
	switch (ledger) {
		case "experience":
			return {
				ledger,
				row: { orgName: "", role: "", startYear: "", endYear: null, isCurrent: false, summary: "" },
			};
		case "education":
			return {
				ledger,
				row: { school: "", credential: "", field: "", startYear: "", endYear: null },
			};
		case "certifications":
			return {
				ledger,
				row: {
					name: "",
					issuer: "",
					issuedYear: "",
					expiresYear: null,
					credentialUrl: null,
					verified: false,
				},
			};
	}
}

/** The stored row `id` names in `ledger`, as a draft, with its position — or `null`. */
export function draftOfRow(
	model: ProfileEditModel,
	ledger: Ledger,
	id: string,
): { draft: LedgerDraft; index: number } | null {
	switch (ledger) {
		case "experience": {
			const index = model.experience.findIndex((r) => r.id === id);
			return index < 0 ? null : { draft: { ledger, row: model.experience[index] }, index };
		}
		case "education": {
			const index = model.education.findIndex((r) => r.id === id);
			return index < 0 ? null : { draft: { ledger, row: model.education[index] }, index };
		}
		case "certifications": {
			const index = model.certifications.findIndex((r) => r.id === id);
			return index < 0 ? null : { draft: { ledger, row: model.certifications[index] }, index };
		}
	}
}

/** The position a NEW row takes in `ledger` — appended, so a refusal's `ledger.<i>` path names it. */
export function appendIndex(model: ProfileEditModel, ledger: Ledger): number {
	return model[ledger].length;
}

/** What one change does to a ledger. */
export type RowOp<T> =
	| { kind: "replace"; id: string; row: T }
	| { kind: "add"; row: T }
	| { kind: "remove"; id: string };

function applyOp<T extends { id?: string }>(rows: Keyed<T>[], op: RowOp<T>): Keyed<T>[] {
	switch (op.kind) {
		case "replace":
			return rows.map((r) => (r.id === op.id ? { ...op.row, id: op.id, key: r.key } : r));
		case "add":
			return [...rows, { ...op.row, id: undefined, key: newKey() }];
		case "remove":
			return rows.filter((r) => r.id !== op.id);
	}
}

/** The whole-list patch that saves `draft` over the row `id`, or appends it when `id` is `null`. */
export function saveRowPatch(
	model: ProfileEditModel,
	draft: LedgerDraft,
	id: string | null,
): ProfileSavePatch {
	const rows = draftOf(model);
	switch (draft.ledger) {
		case "experience":
			return blockPatch(model, {
				experience: applyOp(
					rows.experience,
					id ? { kind: "replace", id, row: draft.row } : { kind: "add", row: draft.row },
				),
			});
		case "education":
			return blockPatch(model, {
				education: applyOp(
					rows.education,
					id ? { kind: "replace", id, row: draft.row } : { kind: "add", row: draft.row },
				),
			});
		case "certifications":
			return blockPatch(model, {
				certifications: applyOp(
					rows.certifications,
					id ? { kind: "replace", id, row: draft.row } : { kind: "add", row: draft.row },
				),
			});
	}
}

/** The whole-list patch that drops the row `id` from `ledger`. */
export function removeRowPatch(
	model: ProfileEditModel,
	ledger: Ledger,
	id: string,
): ProfileSavePatch {
	const rows = draftOf(model);
	switch (ledger) {
		case "experience":
			return blockPatch(model, { experience: applyOp(rows.experience, { kind: "remove", id }) });
		case "education":
			return blockPatch(model, { education: applyOp(rows.education, { kind: "remove", id }) });
		case "certifications":
			return blockPatch(model, {
				certifications: applyOp(rows.certifications, { kind: "remove", id }),
			});
	}
}

/**
 * The refusals that belong to one row, re-keyed to the row's own fields (`experience.3.role` →
 * `role`), plus `form` for one that names only the row or the whole list.
 */
export function rowErrors(
	errors: Readonly<Record<string, string>>,
	ledger: Ledger,
	index: number,
): Record<string, string> {
	const out: Record<string, string> = {};
	const prefix = `${ledger}.${index}`;
	for (const [key, message] of Object.entries(errors)) {
		if (key === prefix || key === ledger) out.form ??= message;
		else if (key.startsWith(`${prefix}.`)) out[key.slice(prefix.length + 1)] ??= message;
	}
	return out;
}
