import { z } from "zod";
import { MessageSenderSchema } from "./messages.ts";
import { ChannelKind } from "./detail.ts";
import { FileCategory } from "../files/categories.ts";

/**
 * projects.files — the Zod SSOT for the File Explorer read (`/projects/[projectId]/files` and the
 * channel-scoped `/projects/[projectId]/[channelId]/files`). A file is an attachment shared inside a
 * project channel, projected with everything the explorer + the universal preview modal need: the
 * asset itself, a category-aware kind, provenance (which channel + message + who + when), and the
 * accompanying chat message the metadata panel shows.
 *
 * Like {@link ProjectDetailSchema} and {@link MessagePageSchema} this is a READ projection, not a
 * table row — the fat {@link ProjectBackendService} DERIVES it deterministically from the resolved
 * `ProjectDetail` while `PROJECTS_BACKEND_LIVE` is off (thin-frontend pattern, root CLAUDE.md §10);
 * the live path (RLS-scoped `files.*` / `messages.*` attachments) slots in behind the same gate with
 * no shape churn. Only enum/array/string/number/boolean primitives are used so the schema is stable
 * across Zod majors (matching the sibling projects schemas).
 */

// #region Kind
/**
 * The asset category — a superset of {@link MessageAttachmentKind} that adds `audio` (voice notes /
 * sound files), `code` (syntax-highlightable text), `doc` (office documents) and `archive` so the
 * preview modal can pick the right inline renderer and the list/grid the right category glyph.
 */
export const FileKind = z.enum([
	"image",
	"video",
	"audio",
	"pdf",
	"doc",
	"code",
	"archive",
	"file",
]);
export type FileKind = z.infer<typeof FileKind>;
// #endregion

// #region File row
/** One file/attachment row in the explorer. */
export const FileItemSchema = z.object({
	/** Stable file id (the grid/list key and the preview-modal selector). */
	id: z.string().min(1).max(120),
	kind: FileKind,
	/**
	 * The rich {@link FileCategory} (search/filter/facets/analytics), classified from name + MIME. It
	 * maps to `kind` for rendering via `CATEGORY_META`; persisted as `files.items.category`.
	 */
	category: FileCategory,
	/** Original filename (also the image alt text + the rename seed). */
	name: z.string().min(1).max(200),
	/** Lower-cased extension, no dot ("png", "pdf", "mp4", "zip", "ts"). */
	ext: z.string().max(12),
	/** Full/preview asset URL ("#" for non-previewable stub assets). */
	url: z.string().max(600),
	/** A preview thumbnail URL (images/videos); `null` → the list/grid renders the category glyph. */
	thumbnailUrl: z.string().max(600).nullable(),
	/** Raw byte size — the sortable "size" column key. */
	sizeBytes: z.number().int().min(0),
	/** Pre-formatted human size ("2.4 MB") so SSR and the client render identically. */
	sizeLabel: z.string().max(16),
	/** Intrinsic pixel dimensions (images/videos); `null` for non-visual files. */
	width: z.number().int().positive().nullable(),
	height: z.number().int().positive().nullable(),
	/** Pre-formatted media duration ("0:42") for audio/video; `null` otherwise. */
	durationLabel: z.string().max(12).nullable(),
	// --- Provenance: the channel + message + sender + time this asset came from ---
	channelId: z.string().min(1).max(120),
	channelName: z.string().min(1).max(160),
	channelKind: ChannelKind,
	/** The message this asset was posted in — siblings share it to form the modal's carousel group. */
	messageId: z.string().min(1).max(120),
	/** The accompanying chat message text (shown in the modal metadata panel; may be empty). */
	messageText: z.string().max(4000),
	/** A voice-note URL when the accompanying message carried one (metadata panel plays it). */
	messageAudioUrl: z.string().max(600).nullable(),
	sender: MessageSenderSchema,
	/** ISO timestamp — the sortable "date" key + grouping. */
	createdAt: z.string(),
	/** Pre-formatted time ("2:30 PM") — UTC-derived so SSR == the client refetch. */
	timeLabel: z.string().max(20),
	/** Pre-formatted relative day ("Today" / "Mon, Jul 14"). */
	dayLabel: z.string().max(24),
	/** Pre-formatted absolute date-time ("Jul 14 · 2:30 PM") — the hover reveal + list column. */
	dateLabel: z.string().max(28),
	/** Whether the actor starred this file (the header Star toggle's on-state). */
	starred: z.boolean(),
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

// #region Sort / scope
/** The property files sort on. */
export const FileSortKey = z.enum(["name", "date", "size", "sender", "type"]);
export type FileSortKey = z.infer<typeof FileSortKey>;

/** Sort direction. */
export const FileSortDir = z.enum(["asc", "desc"]);
export type FileSortDir = z.infer<typeof FileSortDir>;

/**
 * Which space the explorer is reading. `channel`/`project` are the engagement scopes; `conversation`
 * is the global-inbox scope (`/messages/[conversationId]/files`) — the SAME projection derived from a
 * conversation's attachments, so the inbox mounts the identical File Explorer rather than a lookalike
 * grid. A conversation read carries its id in `channelId` (the unified `chatId`); `projectId` holds the
 * conversation id too, keeping the params shape common to all three scopes.
 */
export const FileScope = z.enum(["channel", "project", "conversation"]);
export type FileScope = z.infer<typeof FileScope>;
// #endregion

// #region Request params
/** The file-list query. `channelId` unset/null selects the whole project (all channels). */
export const FileListParamsSchema = z.object({
	projectId: z.string().min(1).max(120),
	channelId: z.string().min(1).max(120).nullable().optional(),
	sort: FileSortKey.optional(),
	dir: FileSortDir.optional(),
	/** Restrict to these kinds (the Attachment-Types filter); empty/absent = all kinds. */
	kinds: z.array(FileKind).max(8).optional(),
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
	scope: FileScope,
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
