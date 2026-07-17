import { z } from "zod";

/**
 * projects.messages — the Zod SSOT for a project channel's CONVERSATION read
 * (`/projects/[projectId]/[channelId]/chat`). Where {@link ProjectDetailSchema} projects the channel
 * TREE, this projects the messages inside one channel: the ordered page the feed renders, the sticky
 * pinned set, and the viewer capability flags that gate pin/favourite. It is a read projection over the
 * eventual `messages.messages` / `messages.attachments` / `messages.reactions` tables (unified with the
 * global inbox by `chatId`, PRODUCT_SPEC §Unified Messaging), not a table row — only enum / array /
 * string / number / boolean primitives + shallow nested objects, so the schema stays stable across Zod
 * majors (matching {@link ProjectDetailSchema}). The richer full-row schemas land alongside their own
 * writes later (root CLAUDE.md §1).
 *
 * Timestamps are carried raw (`createdAt`, an ISO string — the ordering + grouping-gap key) AND
 * pre-formatted (`timeLabel`, `dayLabel`) so SSR and the client render identical clocks with no
 * locale/timezone hydration drift (mirrors the feed's `budgetLabel`/`nextSessionLabel`).
 */

// #region Sender
/** The author of a user message — the identity the bubble's avatar + name link to `/@handle`. */
export const MessageSenderSchema = z.object({
	/** Stable participant id. */
	id: z.string().min(1).max(80),
	name: z.string().min(1).max(120),
	/** Avatar URL (Unsplash face crops in fixtures, §C.4) or null → initials fallback. */
	avatar: z.string().max(400).nullable(),
	/** The `@handle` the avatar + name link to (canonical `/[handle]`, Decision #3); null → no link. */
	handle: z.string().max(40).nullable(),
});
export type MessageSender = z.infer<typeof MessageSenderSchema>;
// #endregion

// #region Attachments (media & files)
/** How an attachment renders: an aspect-correct image, a video tile, a PDF card, or a generic file. */
export const MessageAttachmentKind = z.enum(["image", "video", "pdf", "file"]);
export type MessageAttachmentKind = z.infer<typeof MessageAttachmentKind>;

/**
 * One attachment on a message. Images/videos carry intrinsic `width`/`height` so a single row lays out
 * in true aspect ratio; mixed or overflowing sets condense into a rounded-square grid (max 4 visible,
 * the 4th a `+N` overlay).
 */
export const MessageAttachmentSchema = z.object({
	id: z.string().min(1).max(80),
	kind: MessageAttachmentKind,
	/** Full/preview asset URL. */
	url: z.string().max(600),
	/** Original filename (shown on file/pdf tiles + as alt text). */
	name: z.string().max(200),
	/** Lower-cased extension (no dot) for the file glyph — e.g. "pdf", "zip". */
	ext: z.string().max(12),
	/** Intrinsic pixel width (images/videos) for aspect-ratio layout; null for files. */
	width: z.number().int().positive().nullable(),
	/** Intrinsic pixel height (images/videos); null for files. */
	height: z.number().int().positive().nullable(),
});
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;
// #endregion

// #region Audio memo
/**
 * An explicit voice message (NOT a file attachment that happens to be audio) — rendered with a
 * play/scrub visualizer matching the composer's recording waveform. `peaks` is the pre-computed
 * amplitude envelope (0..1) the visualizer resamples to bar count.
 */
export const MessageAudioSchema = z.object({
	url: z.string().max(600),
	durationMs: z.number().int().min(0),
	/** Pre-formatted `m:ss` duration (no client clock math). */
	durationLabel: z.string().max(12),
	/** Amplitude envelope, newest last, normalised 0..1 (resampled to the rendered bar count). */
	peaks: z.array(z.number().min(0).max(1)).max(512),
});
export type MessageAudio = z.infer<typeof MessageAudioSchema>;
// #endregion

// #region System activity
/**
 * The event a system-activity message reports inline — a subtle, INTERACTIVE notification (clicking it
 * routes to `targetHref`). Mirrors the lifecycle events a channel surfaces (submissions, tickets,
 * membership, escrow releases). The set is additive; unknown future kinds fall back to a neutral glyph.
 */
export const SystemActivityType = z.enum([
	"submission_made",
	"ticket_created",
	"ticket_closed",
	"revision_requested",
	"stage_completed",
	"member_joined",
	"member_left",
	"payment_released",
]);
export type SystemActivityType = z.infer<typeof SystemActivityType>;

/** A system-activity payload — its human line + the in-app target the whole notification routes to. */
export const SystemActivitySchema = z.object({
	type: SystemActivityType,
	/** The rendered line, e.g. "Mara made a submission on Concepts". */
	text: z.string().min(1).max(240),
	/** The route the notification links to (e.g. a submission), or null when there is no target. */
	targetHref: z.string().max(300).nullable(),
});
export type SystemActivity = z.infer<typeof SystemActivitySchema>;
// #endregion

// #region Reactions
/** One emoji reaction bucket on a message. */
export const MessageReactionSchema = z.object({
	emoji: z.string().min(1).max(16),
	count: z.number().int().min(1),
	/** Whether the acting viewer is in this bucket (drives the active pill state). */
	mine: z.boolean(),
});
export type MessageReaction = z.infer<typeof MessageReactionSchema>;
// #endregion

// #region Message
/** `user` = an authored bubble (sender + text/media/audio); `system` = an inline activity notice. */
export const ChatMessageType = z.enum(["user", "system"]);
export type ChatMessageType = z.infer<typeof ChatMessageType>;

/** One message in a channel — a user bubble or an inline system-activity notice. */
export const ChatMessageSchema = z.object({
	id: z.string().min(1).max(80),
	type: ChatMessageType,
	/** ISO timestamp — the sort key AND the raw value the grouping-gap math reads (locale-independent). */
	createdAt: z.string(),
	/** Pre-formatted clock revealed on hover, e.g. "2:30 PM". */
	timeLabel: z.string().max(20),
	/** Pre-formatted day label for date dividers, e.g. "Today" / "Mon, Jul 14". */
	dayLabel: z.string().max(24),
	/** The author (user messages); null on system notices. */
	sender: MessageSenderSchema.nullable(),
	/** Whether the acting viewer authored this — drives right-alignment + hidden metadata. */
	isOwn: z.boolean(),
	/** Text body — may be empty for a media-only / audio-only message. */
	text: z.string().max(4000),
	attachments: z.array(MessageAttachmentSchema),
	/** An explicit voice memo, or null. */
	audio: MessageAudioSchema.nullable(),
	/** The system-activity payload when `type === "system"`, else null. */
	system: SystemActivitySchema.nullable(),
	reactions: z.array(MessageReactionSchema),
	/** Whether this message is pinned to the channel's sticky banner. */
	pinned: z.boolean(),
	/** Whether the viewer favourited (starred) this message — drives the wonky-star border mark. */
	favorited: z.boolean(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
// #endregion

// #region Viewer capabilities
/**
 * The acting viewer's capabilities in THIS channel. `canPin` is re-derived server-side (never trusted
 * from the client, root CLAUDE.md §6): anyone may pin in a private DM; in a project/team channel only a
 * viewer granted permission by the project owner may.
 */
export const ChannelPermissionsSchema = z.object({
	canPin: z.boolean(),
});
export type ChannelPermissions = z.infer<typeof ChannelPermissionsSchema>;
// #endregion

// #region Page + params
/**
 * A page of channel messages, oldest→newest. Bottom-anchored history: the first request returns the
 * LATEST page (`before` unset); scrolling up requests older pages via `nextCursor`.
 */
export const MessagePageSchema = z.object({
	channelId: z.string().min(1).max(120),
	/** This page's messages, ordered oldest → newest. */
	messages: z.array(ChatMessageSchema),
	/** Whether older history exists before `messages[0]` (drives load-on-scroll-up). */
	hasMore: z.boolean(),
	/** The cursor to pass back as `before` for the next-older page; null when at the beginning. */
	nextCursor: z.string().max(80).nullable(),
	/** Up to 3 pinned messages for the sticky banner, most-recent first. */
	pinned: z.array(ChatMessageSchema).max(3),
	permissions: ChannelPermissionsSchema,
	/** Total messages in the channel — `0` triggers the empty state. */
	total: z.number().int().min(0),
});
export type MessagePage = z.infer<typeof MessagePageSchema>;

/** Query params for a channel message page (the load-latest + load-older cursor). */
export const MessagePageParamsSchema = z.object({
	projectId: z.string().min(1).max(120),
	channelId: z.string().min(1).max(120),
	/** Fetch messages strictly BEFORE this message id (the scroll-up cursor); unset = latest page. */
	before: z.string().max(80).nullable().optional(),
	/** Page size (default resolved server-side). */
	limit: z.number().int().min(1).max(100).optional(),
});
export type MessagePageParams = z.infer<typeof MessagePageParamsSchema>;
// #endregion
