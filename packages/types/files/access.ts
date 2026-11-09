import { z } from "zod";
import { AssetVisibility } from "./assets.ts";

/**
 * files.access — the Zod SSOT for who may open one stored file and what they may do with it
 * (Decision #402): the inspector's Access tab reads {@link ItemAccess} and saves
 * {@link SetItemAccess} in one write.
 *
 * Four tiers stay the reach (`private` · `restricted` · `link` · `public`). A **grant** names one
 * person, team, business or project that may open the file, as a viewer or an editor. Grants count
 * while the file is not `private`, so choosing Private pauses every grant and every link share at
 * once, and choosing Restricted again brings them back. An editor may change who has access, never
 * the tier or the library's member switch, which stay the owner's.
 *
 * A file's library decides who reads it before any grant: a team's, business's or enterprise's
 * members (unless the owner turns `memberAccess` off, which leaves the library's admins), a project
 * room's people (always: a project's files are the engagement's record), or nobody but the owner.
 */

// #region Vocabulary
/** Who a file can be granted to. */
export const GranteeKind = z.enum(["user", "team", "business", "project"]);
export type GranteeKind = z.infer<typeof GranteeKind>;

/** What a grant lets its holder do: open and download, or also change who has access. */
export const GrantRole = z.enum(["viewer", "editor"]);
export type GrantRole = z.infer<typeof GrantRole>;

/** The viewer's own standing on the file. */
export const AccessStanding = z.enum(["owner", "editor", "viewer"]);
export type AccessStanding = z.infer<typeof AccessStanding>;

/** The most grants one file may hold. */
export const ACCESS_GRANTS_MAX = 50;

/** A grantee's identity, unique within one file's grants. */
export function granteeKey(grantee: { kind: GranteeKind; id: string }): string {
	return `${grantee.kind}:${grantee.id.toLowerCase()}`;
}

/** The label of a level, as a picker and a row print it. */
export function grantRoleLabel(role: GrantRole): string {
	return role === "editor" ? "Can edit" : "Can view";
}

/** What a level allows, in one sentence. */
export function grantRoleNote(role: GrantRole): string {
	return role === "editor"
		? "Can open and download it, and change who else has access."
		: "Can open and download it.";
}

/** The tiers the Access tab offers, least to most reachable. */
export const ACCESS_TIERS: readonly AssetVisibility[] = AssetVisibility.options;
// #endregion

// #region Read
/** One live grant, named for the people who may manage it. */
export const ItemGrantSchema = z.object({
	kind: GranteeKind,
	id: z.string().uuid(),
	role: GrantRole,
	name: z.string().min(1).max(160),
	/** A quiet second line: `@handle`, or what the entity is. */
	detail: z.string().max(160).nullable(),
	/** The grantee's public picture address, or `null` for initials. */
	avatar: z.string().max(400).nullable(),
	grantedAt: z.string(),
});
export type ItemGrant = z.infer<typeof ItemGrantSchema>;

/** The library a file sits in, and the access it hands out before any grant. */
export const AccessContainerSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("personal") }),
	z.object({
		kind: z.literal("entity"),
		entityKind: z.enum(["team", "business", "enterprise"]),
		entityId: z.string().uuid(),
		name: z.string().min(1).max(160),
		/** Whether every active member may open it; off leaves the library's admins. */
		memberAccess: z.boolean(),
	}),
	z.object({
		kind: z.literal("project"),
		projectId: z.string().uuid(),
		name: z.string().min(1).max(200),
	}),
]);
export type AccessContainer = z.infer<typeof AccessContainerSchema>;

/** Everything the Access tab shows for one file, as this viewer may know it. */
export const ItemAccessSchema = z.object({
	itemId: z.string().uuid(),
	visibility: AssetVisibility,
	standing: AccessStanding,
	container: AccessContainerSchema,
	/** The live grants; empty for a viewer, who is not shown who else has access. */
	grants: z.array(ItemGrantSchema),
	/** The owner's user id, so a picker never offers them; the owner and editors only, else `null`. */
	ownerId: z.string().uuid().nullable(),
	/** Messages that carry the file as a link share; the owner only, else `null`. */
	messageShares: z.number().int().min(0).nullable(),
	/** The live share link's path (`/share/{slug}`); the owner only, else `null`. */
	shareUrl: z.string().max(400).nullable(),
});
export type ItemAccess = z.infer<typeof ItemAccessSchema>;

/** Whether this viewer may change who has access (the owner, or an editor). */
export function canEditAccess(access: Pick<ItemAccess, "standing">): boolean {
	return access.standing === "owner" || access.standing === "editor";
}
// #endregion

// #region Write
/** One grant as a save asks for it. */
export const AccessGrantInputSchema = z.object({
	kind: GranteeKind,
	id: z.string().uuid(),
	role: GrantRole,
});
export type AccessGrantInput = z.infer<typeof AccessGrantInputSchema>;

/**
 * One save of the Access tab. `grants`, when present, is the WHOLE list the file should hold after it:
 * a live grant missing from it is revoked. An absent field is left as it is. The tier and the member
 * switch are the owner's; an editor sends neither.
 */
export const SetItemAccessSchema = z.object({
	itemId: z.string().uuid(),
	visibility: AssetVisibility.optional(),
	memberAccess: z.boolean().optional(),
	grants: z.array(AccessGrantInputSchema).max(ACCESS_GRANTS_MAX).optional(),
}).refine(
	(v) => !v.grants || new Set(v.grants.map(granteeKey)).size === v.grants.length,
	{ message: "Each person, team or project can be added once.", path: ["grants"] },
).refine(
	(v) => v.visibility !== undefined || v.memberAccess !== undefined || v.grants !== undefined,
	{ message: "Nothing to change.", path: ["itemId"] },
);
export type SetItemAccess = z.infer<typeof SetItemAccessSchema>;
// #endregion

// #region Picker
/** A team, business or project the viewer may grant a file to: one they belong to. */
export const AccessTargetSchema = z.object({
	kind: z.enum(["team", "business", "project"]),
	id: z.string().uuid(),
	name: z.string().min(1).max(200),
	detail: z.string().max(160).nullable(),
	avatar: z.string().max(400).nullable(),
});
export type AccessTarget = z.infer<typeof AccessTargetSchema>;

/** The viewer's grantable teams, businesses and projects, filtered by an optional query. */
export const AccessTargetListSchema = z.object({ targets: z.array(AccessTargetSchema) });
export type AccessTargetList = z.infer<typeof AccessTargetListSchema>;
// #endregion
