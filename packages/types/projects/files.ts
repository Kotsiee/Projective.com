import { z } from "zod";
import { MessageSenderSchema } from "./messages.ts";
import { ChannelKind } from "./detail.ts";
import { AssetItemSchema } from "../files/assets.ts";

/**
 * projects.files — the Zod SSOT for the File Explorer read (`/projects/[projectId]/files` and the
 * channel-scoped `/projects/[projectId]/[channelId]/files`). A file is an attachment shared inside a
 * project channel, projected with everything the explorer + the universal preview modal need: the
 * asset itself, a category-aware kind, provenance (which channel + message + who + when), and the
 * accompanying chat message the metadata panel shows.
 *
 * **This module is now a NARROWING of {@link AssetItemSchema}, not an independent shape.** The files
 * domain owns the universal asset projection (see `../files/assets.ts` for why); a project-channel
 * attachment is that projection with its provenance fields re-mandated — a file posted in a channel
 * always HAS a channel, a message and a sender, where a hub-uploaded or drive-mounted asset has
 * none. Narrowing rather than duplicating is what keeps the two from drifting, and it makes
 * `FileItem` assignable to `AssetItem` so one set of cards, tables and preview panes serves both.
 *
 * `FileKind`, `FileScope`, `FileSortKey` and `FileSortDir` are re-exported from the files domain so
 * every existing `from "@projective/types/projects"` import keeps resolving unchanged.
 *
 * Like {@link ProjectDetailSchema} and {@link MessagePageSchema} this is a READ projection, not a
 * table row — the fat {@link ProjectBackendService} DERIVES it deterministically from the resolved
 * `ProjectDetail` while `PROJECTS_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10);
 * the live path (RLS-scoped `files.*` / `messages.*` attachments) slots in behind the same gate with
 * no shape churn. Only enum/array/string/number/boolean primitives are used so the schema is stable
 * across Zod majors (matching the sibling projects schemas).
 */

// #region Re-exported vocabulary
export {
	AssetSource,
	AssetVisibility,
	consumesQuota,
	FileScope,
	FileSortDir,
	FileSortKey,
	messageAttachmentFacets,
	sourceLabel,
	visibilityLabel,
} from "../files/assets.ts";
export type {
	AssetItem,
	AssetSource as AssetSourceType,
	AssetVisibility as AssetVisibilityType,
	FileScope as FileScopeType,
	FileSortDir as FileSortDirType,
	FileSortKey as FileSortKeyType,
} from "../files/assets.ts";
export { FileKind } from "../files/kinds.ts";
export type { FileKind as FileKindType } from "../files/kinds.ts";
// #endregion

// #region File row
/**
 * One file/attachment row in the explorer — {@link AssetItemSchema} with message provenance
 * re-mandated. `messageAudioUrl` stays nullable: a message may or may not carry a voice note.
 */
export const FileItemSchema = AssetItemSchema.extend({
	/** The channel this asset was posted in. */
	channelId: z.string().min(1).max(120),
	channelName: z.string().min(1).max(160),
	channelKind: ChannelKind,
	/** The message this asset was posted in — siblings share it to form the modal's carousel group. */
	messageId: z.string().min(1).max(120),
	/** The accompanying chat message text (shown in the modal metadata panel; may be empty). */
	messageText: z.string().max(4000),
	sender: MessageSenderSchema,
});
export type FileItem = z.infer<typeof FileItemSchema>;
// #endregion

// #region Channel reference (project-scope tree)
/**
 * One channel node for the project-scope explorer's tree navigator — the top-level "Channels" group.
 * `count` is the number of files in the channel (a muted secondary figure, not an in-row status).
 */
export const FileChannelRefSchema = z.object({
	id: z.string().min(1).max(120),
	name: z.string().min(1).max(160),
	kind: ChannelKind,
	count: z.number().int().min(0),
});
export type FileChannelRef = z.infer<typeof FileChannelRefSchema>;
// #endregion

// #region Request params
/** The file-list query. `channelId` unset/null selects the whole project (all channels). */
export const FileListParamsSchema = z.object({
	projectId: z.string().min(1).max(120),
	channelId: z.string().min(1).max(120).nullable().optional(),
	sort: z.enum(["name", "date", "size", "sender", "type"]).optional(),
	dir: z.enum(["asc", "desc"]).optional(),
	/** Restrict to these kinds (the Attachment-Types filter); empty/absent = all kinds. */
	kinds: z.array(z.enum([
		"image",
		"video",
		"audio",
		"pdf",
		"doc",
		"code",
		"archive",
		"link",
		"file",
	])).max(9).optional(),
	/** Free-text filename match. */
	query: z.string().max(120).optional(),
	/** Opaque paging cursor (the id of the last item of the previous page). */
	cursor: z.string().max(120).nullable().optional(),
	limit: z.number().int().min(1).max(200).optional(),
});
export type FileListParams = z.infer<typeof FileListParamsSchema>;
// #endregion

// #region Page envelope
/** A page of files plus the channel index (for the project-scope tree) + viewer identity. */
export const FileListPageSchema = z.object({
	scope: z.enum(["channel", "project", "conversation", "hub", "drive", "share"]),
	projectId: z.string().min(1).max(120),
	channelId: z.string().max(120).nullable(),
	/** The matched files, already sorted + filtered, oldest-cursor→newest-cursor per the paging. */
	items: z.array(FileItemSchema),
	/**
	 * Every channel that holds files (project scope → all channels as the tree's top level; channel
	 * scope → just the one). Counts reflect the WHOLE channel, independent of the active filter.
	 */
	channels: z.array(FileChannelRefSchema),
	hasMore: z.boolean(),
	nextCursor: z.string().max(120).nullable(),
	/** Total matched across all pages (drives the "N files" caption). */
	total: z.number().int().min(0),
	/** The acting viewer's sender id — gates the modal's inline rename (own files only). */
	viewerId: z.string().max(80),
});
export type FileListPage = z.infer<typeof FileListPageSchema>;
// #endregion
