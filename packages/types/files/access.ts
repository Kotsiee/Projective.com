import { z } from "zod";
import { AssetVisibility, FileSlugSchema } from "./assets.ts";

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
	/** The owner has confirmed that the share links this tier drop ends will stop working. */
	stopLinks: z.boolean().optional(),
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

// #region Tier drop
/**
 * The code a tier drop answers (409) while live share links would stop (Decision #570): going to Only
 * you or Specific people revokes every share link to the file, so the save waits for the owner to
 * confirm, then is sent again with `stopLinks`.
 */
export const LINKS_WOULD_STOP = "links_would_stop";

/** Whether a tier ends a file's share links: anything below Anyone with the link. */
export function stopsShareLinks(visibility: AssetVisibility): boolean {
	return visibility === "private" || visibility === "restricted";
}

/** How many share links a refused tier drop would stop, from its 409's details; `null` for any other answer. */
export function linksWouldStop(details: Record<string, unknown> | undefined): number | null {
	return details?.code === LINKS_WOULD_STOP && typeof details.links === "number"
		? details.links
		: null;
}

/** The confirm's sentence for a tier drop that stops `links` share links. */
export function linksWouldStopNote(links: number): string {
	return links === 1
		? "Its share link stops working, for everyone you sent it to. A new link can be made later."
		: `Its ${links} share links stop working, for everyone you sent them to. A new link can be made later.`;
}
// #endregion

// #region Shared with me
/**
 * One file another person shared with the viewer (`files.list_shared_with_me`, Decision #570): by name,
 * or with a team, business or project the viewer is in. `via` says which; `viaName` names the group.
 */
export const SharedFileSchema = z.object({
	itemId: z.string().uuid(),
	/** The file's inspector address (`fil-…`, Decision #563). */
	slug: FileSlugSchema,
	name: z.string().min(1).max(400),
	mimeType: z.string().max(255),
	sizeBytes: z.number().int().min(0),
	role: GrantRole,
	via: GranteeKind,
	viaName: z.string().max(200).nullable(),
	sharedByName: z.string().max(200).nullable(),
	sharedAt: z.string(),
});
export type SharedFile = z.infer<typeof SharedFileSchema>;

/** Shared with me's address: a page state of `/files`, not a folder (ROUTING.md). */
export function sharedWithMeHref(): string {
	return "/files?source=shared";
}

/** The viewer's Shared with me, newest share first. */
export const SharedWithMeSchema = z.object({ files: z.array(SharedFileSchema) });
export type SharedWithMe = z.infer<typeof SharedWithMeSchema>;

/** The row `files.list_shared_with_me` answers, as PostgREST returns it. */
export const SharedFileRowSchema = z.object({
	item_id: z.string().uuid(),
	slug: FileSlugSchema,
	name: z.string(),
	mime_type: z.string(),
	size_bytes: z.coerce.number(),
	role: GrantRole,
	via_kind: GranteeKind,
	via_name: z.string().nullable(),
	shared_by: z.string().uuid().nullable(),
	shared_by_name: z.string().nullable(),
	shared_at: z.string(),
});
export type SharedFileRow = z.infer<typeof SharedFileRowSchema>;

/** One RPC row as the SSOT's {@link SharedFile}. */
export function toSharedFile(row: SharedFileRow): SharedFile {
	return {
		itemId: row.item_id,
		slug: row.slug,
		name: row.name,
		mimeType: row.mime_type,
		sizeBytes: row.size_bytes,
		role: row.role,
		via: row.via_kind,
		viaName: row.via_name,
		sharedByName: row.shared_by_name,
		sharedAt: row.shared_at,
	};
}

/** How a Shared with me row says where it came from: "You", or the team, business or project. */
export function sharedViaLabel(file: Pick<SharedFile, "via" | "viaName">): string {
	return file.via === "user"
		? "Shared with you"
		: `Shared with ${file.viaName ?? `your ${file.via}`}`;
}
// #endregion
