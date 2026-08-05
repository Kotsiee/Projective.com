import { z } from "zod";
import { FileKind } from "./kinds.ts";
import { FileCategory } from "./categories.ts";

/**
 * files.assets — the Zod SSOT for an asset anywhere on the platform.
 *
 * THE WIDENING. `projects/files.ts` `FileItemSchema` models one thing precisely: an attachment
 * posted inside a project channel. It therefore MANDATES message provenance — `channelId`,
 * `channelName`, `channelKind`, `messageId`, `messageText`, `sender`. That is correct for what it
 * describes and wrong for everything the `/files` hub introduces: an asset uploaded straight to a
 * personal library, a file mounted from a connected Google Drive, and a web link stored as an
 * attachment all belong to no channel and were posted in no message.
 *
 * Rather than fork a second file shape (which would double every card, table, preview and modal),
 * `AssetItemSchema` is the SUPERSET with provenance made **nullable**, and `FileItemSchema` is
 * re-expressed as a NARROWING of it that re-mandates those fields. `FileItem` stays assignable to
 * `AssetItem`, so every existing consumer compiles unchanged while the reusable components only need
 * their prop types widened once and their provenance reads null-guarded.
 *
 * Provenance is kept **flat and nullable**, not nested under an optional object: nesting would force
 * an edit at every `file.sender` / `file.channelId` read across four components, where flat+nullable
 * is a pure widening the type-checker walks for you.
 *
 * Like its sibling read projections this schema is derived by the fat `FilesBackendService` while
 * `FILES_BACKEND_LIVE` is off; the live path (RLS-scoped `files.items` / `files.folders`) slots in
 * behind the same gate with no shape churn. Only enum/array/string/number/boolean primitives are
 * used so the module stays stable across Zod majors.
 */

// #region Vocabulary

/**
 * Where an asset physically lives. `supabase` is the platform's own storage (the only source that
 * consumes quota); the four connector sources are MOUNTED — browsable and attachable in place,
 * counted against the provider's quota, not ours — and `link` is a URL stored as a first-class
 * asset with no bytes at all.
 */
export const AssetSource = z.enum([
	"supabase",
	"google_drive",
	"dropbox",
	"frameio",
	"s3",
	"link",
]);
export type AssetSource = z.infer<typeof AssetSource>;

/**
 * The privacy scope hierarchy (PRODUCT_SPEC §Assets & Attachments).
 *
 * - `private` — the default. Readable only by the owner (and, for an entity-owned asset, members
 *   holding the matching capability).
 * - `link` — "link only". Reachable by anyone holding the opaque, server-minted `shareSlug`, and
 *   ONLY through the share route. Elevated automatically when an asset is attached inside a
 *   semi-private context (a channel, a DM, a project submission), because a recipient who can read
 *   the message must be able to read what it carries.
 * - `public` — world-readable. Elevated automatically when attached to a public entity (a service,
 *   a product, a public profile, a banner).
 *
 * Elevation is one-directional and automatic; DE-escalation is always an explicit owner action, so
 * attaching an asset can never silently narrow access that something else already depends on.
 */
export const AssetVisibility = z.enum(["private", "link", "public"]);
export type AssetVisibility = z.infer<typeof AssetVisibility>;

/** Which kind of principal owns an asset — the axis storage quota is metered against. */
export const AssetOwnerType = z.enum(["user", "team", "business", "organisation"]);
export type AssetOwnerType = z.infer<typeof AssetOwnerType>;

/**
 * The lifecycle state of the stored object behind an asset, mirroring `files.file_status`
 * member-for-member.
 *
 * This is NOT the same axis as {@link LinkScanStatus}: `scanning` here means the platform is
 * virus/MIME-checking BYTES it holds in quarantine, while a link scan is a reputation check on a
 * URL whose bytes we never possess. An asset can be `uploaded` with a `pending` link scan, and the
 * two render differently, so collapsing them would make one of the two states unshowable.
 */
export const FileStatus = z.enum([
	"pending_upload",
	"scanning",
	"uploaded",
	"error",
	"quarantined",
]);
export type FileStatus = z.infer<typeof FileStatus>;

/**
 * The verdict of the link-safety pipeline. `unscannable` is deliberately distinct from `suspicious`:
 * "we could not reach it" is not "we found something", and collapsing the two would either cry wolf
 * on every transient timeout or wave through a host that refuses inspection.
 */
export const LinkScanStatus = z.enum([
	"pending",
	"safe",
	"suspicious",
	"blocked",
	"unscannable",
]);
export type LinkScanStatus = z.infer<typeof LinkScanStatus>;

/**
 * Which space is being read. `channel` / `project` are the engagement scopes and `conversation` the
 * global-inbox one (all three pre-existing, Decisions #32/#50); `hub` is the personal/entity library
 * at `/files`, `drive` a mounted connector, and `share` the public resolution of a `shareSlug`.
 */
export const FileScope = z.enum([
	"channel",
	"project",
	"conversation",
	"hub",
	"drive",
	"share",
]);
export type FileScope = z.infer<typeof FileScope>;

/** The property assets sort on. */
export const FileSortKey = z.enum(["name", "date", "size", "sender", "type"]);
export type FileSortKey = z.infer<typeof FileSortKey>;

/** Sort direction. */
export const FileSortDir = z.enum(["asc", "desc"]);
export type FileSortDir = z.infer<typeof FileSortDir>;

/**
 * The channel-kind vocabulary, declared HERE rather than imported from `../projects/detail.ts`.
 *
 * This module sits below the projects domain in the dependency graph (`projects/files.ts` imports
 * it), so reaching back up would close an import cycle — and a cycle in a module whose corpus is
 * built at import time is not a style problem but the TDZ crash class recorded in Decision #49.
 * `projects/files.ts` narrows this back to its own `ChannelKind`; the literals are identical and the
 * narrowing is what keeps them from drifting.
 */
export const AssetChannelKind = z.enum(["general", "stage", "team", "dm"]);
export type AssetChannelKind = z.infer<typeof AssetChannelKind>;

/**
 * Whoever put the asset where it is. Structurally identical to `MessageSenderSchema` (same four
 * fields, same names — `avatar`, not `avatarUrl`) so `FileItemSchema` can narrow this field to the
 * projects type without any consumer noticing.
 */
export const AssetActorSchema = z.object({
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	/** Avatar URL, or null → the initials fallback. */
	avatar: z.string().max(400).nullable(),
	/** The `@handle` the avatar + name link to (canonical `/[handle]`, Decision #3); null → no link. */
	handle: z.string().max(40).nullable(),
});
export type AssetActor = z.infer<typeof AssetActorSchema>;

// #endregion

// #region Connector + link facets

/**
 * The back-reference to a mounted third-party object. Present only when `source !== "supabase"` and
 * `source !== "link"`. `externalEtag` is the connector's own change token — the delta-sync cursor
 * that lets a re-browse skip an object whose bytes have not moved.
 */
export const ExternalRefSchema = z.object({
	/** The `integrations.user_connections` row this asset was mounted through. */
	connectionId: z.string().min(1).max(80),
	providerSlug: z.string().min(1).max(40),
	externalFileId: z.string().min(1).max(200),
	externalParentId: z.string().max(200).nullable(),
	/** The provider's own "open in Drive/Dropbox" URL — the only safe way to hand off. */
	externalWebUrl: z.string().max(600).nullable(),
	externalEtag: z.string().max(120).nullable(),
});
export type ExternalRef = z.infer<typeof ExternalRefSchema>;

/**
 * A web link stored as a first-class asset. Present only when `source === "link"`.
 *
 * `faviconUrl` points at a **re-hosted** copy in the platform's own public bucket, never at the
 * origin's `/favicon.ico`. Hotlinking would leak every viewer's IP address to a host the link's
 * author chose, which turns pasting a link into an IP-harvesting primitive.
 */
export const LinkAttachmentSchema = z.object({
	/** The absolute target URL. Only `https:` is ever ingested (see the SSRF note in the service). */
	url: z.string().min(1).max(2000),
	/** Registrable host, shown as the card's subtitle ("figma.com"). */
	domain: z.string().min(1).max(253),
	/** Page title resolved at ingest; falls back to the domain when unavailable. */
	title: z.string().max(300),
	description: z.string().max(600).nullable(),
	/** Re-hosted favicon in `public_assets`; null → the generic link glyph. */
	faviconUrl: z.string().max(600).nullable(),
	scanStatus: LinkScanStatus,
	/** ISO timestamp of the last scan; null while `pending`. */
	scannedAt: z.string().nullable(),
});
export type LinkAttachment = z.infer<typeof LinkAttachmentSchema>;

// #endregion

// #region Asset row

/**
 * One asset row — the universal projection every grid cell, table row, preview pane and picker tile
 * renders from.
 */
export const AssetItemSchema = z.object({
	// --- Identity + rendering (identical to the pre-existing FileItem) ---
	/** Stable asset id (the grid/list key and the preview-modal selector). */
	id: z.string().min(1).max(120),
	kind: FileKind,
	/**
	 * The rich {@link FileCategory} (search/filter/facets/analytics), classified from name + MIME. It
	 * maps to `kind` for rendering via `CATEGORY_META`; persisted as `files.items.category`.
	 */
	category: FileCategory,
	/** Original filename (also the image alt text + the rename seed). */
	name: z.string().min(1).max(200),
	/** Lower-cased extension, no dot ("png", "pdf", "mp4", "zip", "ts"); empty for links. */
	ext: z.string().max(12),
	/** Full/preview asset URL ("#" for non-previewable stub assets). */
	url: z.string().max(2000),
	/** A preview thumbnail URL (images/videos); `null` → the list/grid renders the category glyph. */
	thumbnailUrl: z.string().max(2000).nullable(),
	/** Raw byte size — the sortable "size" column key. Always 0 for a link (it stores no bytes). */
	sizeBytes: z.number().int().min(0),
	/** Pre-formatted human size ("2.4 MB") so SSR and the client render identically. */
	sizeLabel: z.string().max(16),
	/** Intrinsic pixel dimensions (images/videos); `null` for non-visual assets. */
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	/** Pre-formatted media duration ("0:42") for audio/video; `null` otherwise. */
	durationLabel: z.string().max(12).nullable(),

	// --- Provenance: NULLABLE here, re-mandated by FileItemSchema ---
	/** The channel this asset was posted in; `null` for a hub-native, mounted or link asset. */
	channelId: z.string().max(120).nullable(),
	channelName: z.string().max(160).nullable(),
	channelKind: AssetChannelKind.nullable(),
	/** The message it was posted in — siblings share it to form the modal's carousel group. */
	messageId: z.string().max(120).nullable(),
	/** The accompanying chat message text (shown in the modal metadata panel; may be empty). */
	messageText: z.string().max(4000).nullable(),
	/** A voice-note URL when the accompanying message carried one (metadata panel plays it). */
	messageAudioUrl: z.string().max(600).nullable(),
	/** Who posted it. `null` for an asset that was uploaded rather than posted. */
	sender: AssetActorSchema.nullable(),

	// --- Time ---
	/** ISO timestamp — the sortable "date" key + grouping. */
	createdAt: z.string(),
	/** Pre-formatted time ("2:30 PM") — UTC-derived so SSR == the client refetch. */
	timeLabel: z.string().max(20),
	/** Pre-formatted relative day ("Today" / "Mon, Jul 14"). */
	dayLabel: z.string().max(24),
	/** Pre-formatted absolute date-time ("Jul 14 · 2:30 PM") — the hover reveal + list column. */
	dateLabel: z.string().max(28),
	/** Whether the actor starred this asset (the header Star toggle's on-state). */
	starred: z.boolean(),

	// --- Hub facets ---
	source: AssetSource,
	/** Lifecycle of the stored bytes — an in-flight upload and a quarantined file must not render alike. */
	status: FileStatus,
	visibility: AssetVisibility,
	ownerType: AssetOwnerType,
	/** The owning principal's id — a user id, or a team/business/organisation id. */
	ownerId: z.string().min(1).max(80),
	/** The owning folder id; `null` at the library root. */
	folderId: z.string().max(120).nullable(),
	/** Materialised ancestor names, root-first — the breadcrumb trail without a second round trip. */
	folderPath: z.array(z.string().max(120)).max(24),
	/**
	 * The content digest used for deduplication, or `null` when the client could not compute one
	 * (an insecure context has no `crypto.subtle`). `hashSampled` records the STRENGTH of the claim:
	 * a sampled digest covers only the head, tail and length, so it is a strong hint and never
	 * sufficient on its own to collapse two assets into one stored object.
	 */
	contentHash: z.string().max(128).nullable(),
	hashSampled: z.boolean(),
	external: ExternalRefSchema.nullable(),
	link: LinkAttachmentSchema.nullable(),
	/** The opaque share token when `visibility !== "private"`; `null` otherwise. */
	shareSlug: z.string().max(64).nullable(),
	downloadCount: z.number().int().min(0),
	/**
	 * Whether the ACTING viewer has already downloaded this asset on this device — the server's
	 * answer to the duplicate-download prompt, so the client never has to guess from `localStorage`.
	 */
	downloadedByViewer: z.boolean(),
	/** Whether the viewer may rename/move/delete/reshare it. Server-derived; never inferred client-side. */
	canManage: z.boolean(),
});
export type AssetItem = z.infer<typeof AssetItemSchema>;

// #endregion

// #region Request params + page envelope

/** The asset-list query. Every field is optional except the scope it is reading. */
export const AssetListParamsSchema = z.object({
	scope: FileScope,
	/**
	 * The scope's subject: a project id (`project`/`channel`), a conversation id (`conversation`), an
	 * owner id (`hub`), a connection id (`drive`), or a share slug (`share`).
	 */
	subjectId: z.string().max(120).nullable().optional(),
	channelId: z.string().max(120).nullable().optional(),
	/** The folder being listed; `null`/absent = the scope root. */
	folderId: z.string().max(120).nullable().optional(),
	/** Path-segment navigation, for a deep-linked `/files/a/b/c` URL. */
	path: z.array(z.string().max(120)).max(24).optional(),
	sort: FileSortKey.optional(),
	dir: FileSortDir.optional(),
	/** Restrict to these kinds (the Attachment-Types filter); empty/absent = all kinds. */
	kinds: z.array(FileKind).max(9).optional(),
	/** Restrict to these sources (the connector filter); empty/absent = all sources. */
	sources: z.array(AssetSource).max(6).optional(),
	visibility: z.array(AssetVisibility).max(3).optional(),
	/** Free-text filename match. */
	query: z.string().max(120).optional(),
	/** Opaque paging cursor (the id of the last item of the previous page). */
	cursor: z.string().max(120).nullable().optional(),
	limit: z.number().int().min(1).max(200).optional(),
});
export type AssetListParams = z.infer<typeof AssetListParamsSchema>;

// #region Pure display helpers

/** Human label for an asset's storage source — the byline fallback when there is no sender. */
export function sourceLabel(source: AssetSource): string {
	switch (source) {
		case "supabase":
			return "My library";
		case "google_drive":
			return "Google Drive";
		case "dropbox":
			return "Dropbox";
		case "frameio":
			return "Frame.io";
		case "s3":
			return "S3";
		case "link":
			return "Web link";
	}
}

/**
 * Human label for a privacy scope. Deliberately phrased from the READER's point of view ("Anyone
 * with the link") rather than the system's ("link"), because the question a person actually has in
 * front of a share control is who can see this, not what the column is called.
 */
export function visibilityLabel(visibility: AssetVisibility): string {
	switch (visibility) {
		case "private":
			return "Only you";
		case "link":
			return "Anyone with the link";
		case "public":
			return "Public";
	}
}

/** Whether an asset physically consumes the platform's own storage quota. */
export function consumesQuota(item: Pick<AssetItem, "source">): boolean {
	return item.source === "supabase";
}

// #endregion

/**
 * The hub facets, isolated as their own type so a producer of the narrower {@link AssetItem}
 * subtypes (a channel attachment, a submission deliverable, a conversation file) can supply them in
 * one spread instead of restating fourteen fields.
 */
export type AssetHubFacets = Pick<
	AssetItem,
	| "source"
	| "status"
	| "visibility"
	| "ownerType"
	| "ownerId"
	| "folderId"
	| "folderPath"
	| "contentHash"
	| "hashSampled"
	| "external"
	| "link"
	| "shareSlug"
	| "downloadCount"
	| "downloadedByViewer"
	| "canManage"
>;

/**
 * The facets an asset carries **by construction** when it was posted as a message attachment rather
 * than uploaded to a library.
 *
 * Visibility defaults to `link` — not `private` — because that is what the privacy hierarchy
 * actually requires: a channel, a DM and a project submission are all semi-private contexts, and an
 * attachment nobody in the thread can open is not an attachment. Elevation happens at the moment of
 * attaching, so encoding it here keeps the fixture corpus and the live path telling the same story.
 *
 * `canManage` is deliberately a parameter and never inferred from `ownerId === viewerId` inside this
 * helper: whether a viewer may rename or delete something is a server decision, and a pure function
 * in the types package is the wrong place to start making it.
 */
export function messageAttachmentFacets(
	ownerId: string,
	opts?: {
		visibility?: AssetVisibility;
		canManage?: boolean;
		shareSlug?: string | null;
		downloadCount?: number;
		downloadedByViewer?: boolean;
	},
): AssetHubFacets {
	return {
		source: "supabase",
		status: "uploaded",
		visibility: opts?.visibility ?? "link",
		ownerType: "user",
		ownerId,
		folderId: null,
		folderPath: [],
		contentHash: null,
		hashSampled: false,
		external: null,
		link: null,
		shareSlug: opts?.shareSlug ?? null,
		downloadCount: opts?.downloadCount ?? 0,
		downloadedByViewer: opts?.downloadedByViewer ?? false,
		canManage: opts?.canManage ?? false,
	};
}

/** One breadcrumb hop in the folder trail. */
export const AssetCrumbSchema = z.object({
	id: z.string().max(120).nullable(),
	label: z.string().min(1).max(160),
	/** The route this crumb navigates to (already scope-correct). */
	href: z.string().max(600),
});
export type AssetCrumb = z.infer<typeof AssetCrumbSchema>;

// #endregion
