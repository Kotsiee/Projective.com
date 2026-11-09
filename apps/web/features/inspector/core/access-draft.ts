import {
	ACCESS_GRANTS_MAX,
	type AccessContainer,
	type AccessStanding,
	type AssetVisibility,
	granteeKey,
	type GranteeKind,
	type GrantRole,
	type ItemAccess,
	type SetItemAccess,
	visibilityLabel,
} from "@projective/types/files";

/**
 * access-draft — the pure decisions behind the inspector's Access tab (Decision #402): the editable
 * copy of a file's access, whether it differs from what is saved, the one write that saves it, and the
 * sentences that say what each tier means for this file.
 */

// #region Draft
/** One grantee in the draft: a saved grant, or one picked since the last save. */
export interface DraftGrant {
	kind: GranteeKind;
	id: string;
	role: GrantRole;
	name: string;
	detail: string | null;
	avatar: string | null;
}

/** The Access tab's editable copy of a file's access. `memberAccess` is `null` outside an entity library. */
export interface AccessDraft {
	visibility: AssetVisibility;
	memberAccess: boolean | null;
	grants: DraftGrant[];
}

/** The draft a saved state starts as. */
export function draftOf(access: ItemAccess): AccessDraft {
	return {
		visibility: access.visibility,
		memberAccess: access.container.kind === "entity" ? access.container.memberAccess : null,
		grants: access.grants.map((g) => ({
			kind: g.kind,
			id: g.id,
			role: g.role,
			name: g.name,
			detail: g.detail,
			avatar: g.avatar,
		})),
	};
}

function grantSignature(grants: readonly DraftGrant[]): string {
	return grants.map((g) => `${granteeKey(g)}=${g.role}`).sort().join("|");
}

/** Whether the draft's grants differ from the saved ones; order does not count. */
export function grantsChanged(saved: AccessDraft, draft: AccessDraft): boolean {
	return grantSignature(saved.grants) !== grantSignature(draft.grants);
}

/** Whether the draft differs from what is saved. */
export function isDirty(saved: AccessDraft, draft: AccessDraft): boolean {
	return saved.visibility !== draft.visibility || saved.memberAccess !== draft.memberAccess ||
		grantsChanged(saved, draft);
}

/**
 * Carry an unsaved draft onto a newer saved state (another surface changed the file meanwhile): each
 * part the person left as it was follows the server, and each part they changed stays theirs, so a
 * later save never undoes a change it did not make.
 */
export function rebaseDraft(
	previous: AccessDraft,
	next: AccessDraft,
	draft: AccessDraft,
): AccessDraft {
	return {
		visibility: draft.visibility === previous.visibility ? next.visibility : draft.visibility,
		memberAccess: draft.memberAccess === previous.memberAccess
			? next.memberAccess
			: draft.memberAccess,
		grants: grantsChanged(previous, draft) ? draft.grants : next.grants,
	};
}

/**
 * The one write that saves the draft, or `null` when nothing changed. Only changed fields travel, the
 * grants as the whole list; an editor never sends the tier or the member switch, and a viewer sends
 * nothing at all.
 */
export function toSetItemAccess(
	itemId: string,
	saved: AccessDraft,
	draft: AccessDraft,
	standing: AccessStanding,
): SetItemAccess | null {
	if (standing === "viewer") return null;
	const owner = standing === "owner";
	const input: SetItemAccess = { itemId };
	if (owner && draft.visibility !== saved.visibility) input.visibility = draft.visibility;
	if (owner && draft.memberAccess !== null && draft.memberAccess !== saved.memberAccess) {
		input.memberAccess = draft.memberAccess;
	}
	if (grantsChanged(saved, draft)) {
		input.grants = draft.grants.map((g) => ({ kind: g.kind, id: g.id, role: g.role }));
	}
	return Object.keys(input).length > 1 ? input : null;
}
// #endregion

// #region Edits
/** Why a grantee was not added. */
export type AddRefusal = "duplicate" | "full";

/** The outcome of {@link addGrantee}: the next draft, and the refusal when it is unchanged. */
export interface AddOutcome {
	draft: AccessDraft;
	refusal: AddRefusal | null;
}

/** The sentence a refusal is shown as, or `null` when nothing needs saying. */
export function addRefusalText(refusal: AddRefusal | null): string | null {
	return refusal === "full"
		? `A file can be shared with up to ${ACCESS_GRANTS_MAX} people, teams and projects.`
		: null;
}

/** Whether a grantee is already in the draft. */
export function hasGrantee(
	draft: AccessDraft,
	grantee: { kind: GranteeKind; id: string },
): boolean {
	const key = granteeKey(grantee);
	return draft.grants.some((g) => granteeKey(g) === key);
}

/** Add a grantee at Can view, unless it is already there or the file is full. */
export function addGrantee(draft: AccessDraft, grantee: Omit<DraftGrant, "role">): AddOutcome {
	if (hasGrantee(draft, grantee)) return { draft, refusal: "duplicate" };
	if (draft.grants.length >= ACCESS_GRANTS_MAX) return { draft, refusal: "full" };
	return {
		draft: { ...draft, grants: [...draft.grants, { ...grantee, role: "viewer" }] },
		refusal: null,
	};
}

/** Take a grantee out of the draft. */
export function removeGrantee(draft: AccessDraft, key: string): AccessDraft {
	return { ...draft, grants: draft.grants.filter((g) => granteeKey(g) !== key) };
}

/** Change one grantee's level. */
export function setGrantRole(draft: AccessDraft, key: string, role: GrantRole): AccessDraft {
	return {
		...draft,
		grants: draft.grants.map((g) => granteeKey(g) === key ? { ...g, role } : g),
	};
}

/** Whether grants open the file at this tier: every tier but Private, which pauses them. */
export function grantsActive(visibility: AssetVisibility): boolean {
	return visibility !== "private";
}
// #endregion

// #region Words
/** The container as the draft would leave it: an entity library's member switch follows the draft. */
export function containerWithDraft(
	container: AccessContainer,
	draft: AccessDraft,
): AccessContainer {
	return container.kind === "entity" && draft.memberAccess !== null
		? { ...container, memberAccess: draft.memberAccess }
		: container;
}

/** A tier's name for this viewer: Private reads "Only you" only to the owner of a personal file. */
export function tierLabel(
	tier: AssetVisibility,
	container: AccessContainer,
	canManage: boolean,
): string {
	if (tier === "private") {
		return canManage && container.kind === "personal" ? "Only you" : "Private";
	}
	return visibilityLabel(tier);
}

function libraryReaders(container: AccessContainer): string | null {
	switch (container.kind) {
		case "personal":
			return null;
		case "entity":
			return container.memberAccess
				? `everyone in ${container.name}`
				: `${container.name}'s admins`;
		case "project":
			return `everyone on ${container.name}`;
	}
}

/** What a tier means for this file, as a consequence rather than a definition. */
export function tierNote(
	tier: AssetVisibility,
	container: AccessContainer,
	canManage: boolean,
): string {
	const you = canManage ? "You" : "Its owner";
	const library = libraryReaders(container);
	switch (tier) {
		case "private":
			return library
				? `${you} and ${library}.`
				: `${canManage ? "Only you" : "Only its owner"} can open it.`;
		case "restricted":
			return library
				? `${you}, ${library}, and the people, teams and projects added below.`
				: `${you} and the people, teams and projects added below.`;
		case "link":
			return "Anyone holding the link can open it without signing in. It isn't listed anywhere.";
		case "public":
			return "Anyone can open it, and search engines may list it.";
	}
}
// #endregion

// #region Save outcomes
/**
 * A refused save's field errors, keyed by grantee: `grants.N` names the Nth grant of the write that was
 * sent, and a `kind:id` key names a grantee directly. Anything else is not a row's to show.
 */
export function rowErrors(
	errors: Readonly<Record<string, string>> | undefined,
	sent: SetItemAccess,
): Record<string, string> {
	const out: Record<string, string> = {};
	if (!errors) return out;
	for (const [field, message] of Object.entries(errors)) {
		const indexed = /^grants\.(\d+)/.exec(field);
		if (indexed) {
			const grant = sent.grants?.[Number(indexed[1])];
			if (grant) out[granteeKey(grant)] = message;
			continue;
		}
		const named = /^(user|team|business|project):(.+)$/.exec(field);
		if (named) out[granteeKey({ kind: named[1] as GranteeKind, id: named[2] })] = message;
	}
	return out;
}
// #endregion

// #region Simulation
/** The standing the dev Context Switcher can stand in for; `auto` follows the server. */
export type FileAccessSim = "auto" | "owner" | "editor" | "viewer" | "signed-out";

/** The standing the tab renders: the server's, unless a simulation stands in for it. */
export function shownStanding(standing: AccessStanding, sim: FileAccessSim): AccessStanding {
	return sim === "owner" || sim === "editor" || sim === "viewer" ? sim : standing;
}
// #endregion
