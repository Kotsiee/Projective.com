import type {
	CertificationEdit,
	EducationEdit,
	ExperienceEdit,
	LanguageEdit,
	ProfileEditModel,
	ProfileSavePatch,
	ProfileSettings,
	ProfileVisibility,
} from "@projective/types/profile";

/**
 * edit-model — the pure half of the owner's editor: the DRAFT the form edits, the PATCH a save
 * sends, and the dirty check between them.
 *
 * A save sends only the sections that changed (the database replaces a list section wholesale, so an
 * untouched list is never re-sent), and a list row carries a client `key` beside its database `id`:
 * the key keeps a row's inputs attached to it while rows are added, removed and reordered; the id —
 * absent on a new row — is what lets the database update a kept row in place rather than replace it.
 */

// #region Draft

/** A list row as the form holds it — the saved shape plus a stable client key. */
export type Keyed<T> = T & { key: string };

export interface EditDraft {
	firstName: string;
	lastName: string;
	name: string;
	headline: string;
	story: string;
	city: string;
	country: string;
	timezone: string;
	visibility: ProfileVisibility;
	languages: Keyed<LanguageEdit>[];
	skills: string[];
	experience: Keyed<ExperienceEdit>[];
	education: Keyed<EducationEdit>[];
	certifications: Keyed<CertificationEdit>[];
	settings: ProfileSettings;
}

let keySeq = 0;
/** A fresh client key — unique within the page's lifetime, never sent anywhere. */
export function newKey(): string {
	keySeq += 1;
	return `k${keySeq}`;
}

function keyed<T extends { id?: string }>(rows: readonly T[]): Keyed<T>[] {
	return rows.map((row) => ({ ...row, key: row.id ?? newKey() }));
}

/** The draft an editor opens on. */
export function draftOf(model: ProfileEditModel): EditDraft {
	return {
		firstName: model.firstName,
		lastName: model.lastName,
		name: model.name,
		headline: model.headline,
		story: model.story,
		city: model.city,
		country: model.country,
		timezone: model.timezone,
		visibility: model.visibility,
		languages: model.languages.map((l, i) => ({ ...l, key: `lang-${i}-${l.code}` })),
		skills: [...model.skills],
		experience: keyed(model.experience),
		education: keyed(model.education),
		certifications: keyed(model.certifications),
		settings: { ...model.settings },
	};
}

// #endregion

// #region Patch

function strip<T>(rows: readonly Keyed<T>[]): T[] {
	return rows.map(({ key: _key, ...row }) => row as unknown as T);
}

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** The sections a profile of this kind edits (`ProfileEditModel.sections`). */
export type EditSections = ProfileEditModel["sections"];

/**
 * The save patch: only the fields and sections that differ from the baseline, and only those this
 * kind of profile edits. An individual's name travels as first + last; an entity's as `name`.
 */
export function patchOf(
	baseline: EditDraft,
	draft: EditDraft,
	sections: EditSections,
	individual: boolean,
): ProfileSavePatch {
	const patch: ProfileSavePatch = {};
	if (sections.identity) {
		if (individual) {
			if (draft.firstName !== baseline.firstName) patch.firstName = draft.firstName.trim();
			if (draft.lastName !== baseline.lastName) patch.lastName = draft.lastName.trim();
		} else if (draft.name !== baseline.name) {
			patch.name = draft.name.trim();
		}
		if (draft.headline !== baseline.headline) patch.headline = draft.headline.trim();
	}
	if (sections.about && draft.story !== baseline.story) patch.story = draft.story;
	if (sections.location) {
		if (draft.city !== baseline.city) patch.city = draft.city.trim();
		if (draft.country !== baseline.country) patch.country = draft.country.trim();
		if (draft.timezone !== baseline.timezone) patch.timezone = draft.timezone;
	}
	if (sections.visibility && draft.visibility !== baseline.visibility) patch.visibility = draft.visibility;
	if (sections.languages && !same(strip(draft.languages), strip(baseline.languages))) {
		patch.languages = strip(draft.languages).map((l) => ({ code: l.code.toUpperCase(), level: l.level }));
	}
	if (sections.skills && !same(draft.skills, baseline.skills)) {
		patch.skills = draft.skills.map((s) => s.trim()).filter((s) => s.length > 0);
	}
	if (sections.experience) {
		if (!same(strip(draft.experience), strip(baseline.experience))) {
			patch.experience = strip(draft.experience).map((e) => ({
				...e,
				endYear: e.isCurrent ? null : e.endYear || null,
			}));
		}
		if (!same(strip(draft.education), strip(baseline.education))) {
			patch.education = strip(draft.education).map((d) => ({ ...d, endYear: d.endYear || null }));
		}
		if (!same(strip(draft.certifications), strip(baseline.certifications))) {
			// `verified` is the platform's claim; it never travels.
			patch.certifications = strip(draft.certifications).map(({ verified: _v, ...c }) => ({
				...c,
				expiresYear: c.expiresYear || null,
				credentialUrl: c.credentialUrl?.trim() ? c.credentialUrl.trim() : null,
			}));
		}
	}
	if (!same(draft.settings, baseline.settings)) patch.settings = { ...draft.settings };
	return patch;
}

/**
 * After a save, give each row that was SENT the id the database now holds for it, so the next save
 * updates the row in place instead of replacing it. Rows are matched by position within the list as
 * it was sent (the database stores them in that order); rows added since the save — not in `sent` —
 * are left as they are. A list whose saved length differs from what was sent is left untouched.
 */
export function withSavedIds(current: EditDraft, sent: EditDraft, saved: EditDraft): EditDraft {
	function adopt<T extends { id?: string }>(
		now: Keyed<T>[],
		was: Keyed<T>[],
		stored: Keyed<T>[],
	): Keyed<T>[] {
		if (was.length !== stored.length) return now;
		const ids = new Map<string, string | undefined>();
		was.forEach((row, i) => ids.set(row.key, stored[i]?.id));
		return now.map((row) => (row.id || !ids.get(row.key) ? row : { ...row, id: ids.get(row.key) }));
	}
	return {
		...current,
		experience: adopt(current.experience, sent.experience, saved.experience),
		education: adopt(current.education, sent.education, saved.education),
		certifications: adopt(current.certifications, sent.certifications, saved.certifications),
	};
}

/** Whether the draft differs from the baseline in anything a save would send. */
export function isDirty(
	baseline: EditDraft,
	draft: EditDraft,
	sections: EditSections,
	individual: boolean,
): boolean {
	return Object.keys(patchOf(baseline, draft, sections, individual)).length > 0;
}

// #endregion

// #region Errors

/**
 * Field-keyed messages from Zod issues (`experience.2.startYear`) or a server refusal
 * (`experience.2`), first message per key — the shape every field in the form looks itself up in.
 */
export function errorsFromIssues(
	issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const issue of issues) {
		const key = issue.path.map(String).join(".") || "form";
		if (!out[key]) out[key] = issue.message;
	}
	return out;
}

/** The message for a field, or for the row that contains it (a server refusal names only the row). */
export function errorFor(errors: Record<string, string>, path: string): string | undefined {
	if (errors[path]) return errors[path];
	const row = path.split(".").slice(0, 2).join(".");
	return row !== path ? errors[row] : undefined;
}

// #endregion
