import {
	assetIdOf,
	type AssetItem,
	categorizeFile,
	categoryToKind,
	type FileCategory,
	fileInspectHref,
	type FileKind,
	mediaProxyHref,
	messageAttachmentFacets,
} from "@projective/types/files";
import type { ChatMessage, MessageAttachment } from "@projective/types/projects";
import {
	type AssetMediaRef,
	assetMediaSrc,
	assetMediaSrcset,
} from "@features/files/core/asset-media.ts";
import type { PreviewContext } from "../components/preview/preview-model.ts";

/**
 * chat-attachments — how a chat bubble's attachments open: the preview context a feed hands the
 * file modal, the {@link AssetItem} rows the modal pages through, and the addresses a tile draws and
 * opens in a new tab. Pure and DOM-free so it is tested without a browser.
 */

// #region Types

/** Which feed a set of attachments is read in: a project room, or an inbox conversation. */
export interface ChatFeedScope {
	kind: "project" | "conversation";
	/** The engagement's route slug, or the conversation id in a conversation. */
	projectId: string;
	/** The room's route ref (`stg-…`, `discussion`, `general`, a team room id), or the conversation id. */
	channelId: string;
}

/** The slice of an attachment a tile draws from. */
export type ChatTileRef = Pick<MessageAttachment, "id" | "kind" | "url" | "ext" | "assetId">;

/** The picture a tile draws: its address (null → the placeholder or glyph) and its candidates. */
export interface ChatTilePicture {
	src: string | null;
	srcset: string | null;
}

/** The placeholder a tile paints beneath its picture. */
export interface ChatTilePlaceholder {
	blurhash: string;
	color: null;
}

// #endregion

// #region Internals

const TEXT_MAX = 4000;
const DATE_LABEL_MAX = 28;
const FALLBACK_NAME = "Attachment";

function ownAddress(url: string): string | null {
	const value = url.trim();
	return value === "" || value === "#" ? null : value;
}

function classify(
	att: Pick<MessageAttachment, "name" | "ext" | "kind" | "mimeType">,
): { kind: FileKind; category: FileCategory } {
	const name = att.name.trim() || (att.ext ? `file.${att.ext}` : "");
	const category = categorizeFile(name, att.mimeType ?? undefined);
	const classified = categoryToKind(category);
	if (classified === "file" && att.kind !== "file") return { kind: att.kind, category };
	return { kind: classified, category };
}

function tileRef(att: ChatTileRef): AssetMediaRef {
	const assetId = attachmentAssetId(att);
	const visual = att.kind === "image" || att.kind === "video";
	return {
		id: `tile:${att.id}`,
		assetId,
		source: "supabase",
		status: "uploaded",
		url: att.url,
		thumbnailUrl: !assetId && visual ? ownAddress(att.url) : null,
		kind: visual ? att.kind : "file",
		ext: att.ext,
	};
}

// #endregion

// #region Scope

/**
 * The feed a `ChatFeed` mount reads. A conversation mounts the feed with its own id as both the
 * project and the channel key (`ConversationChat`); a project room never does, because a `prj-…`
 * slug is never a room ref.
 */
export function chatFeedScope(projectId: string, channelId: string): ChatFeedScope {
	return { kind: projectId === channelId ? "conversation" : "project", projectId, channelId };
}

/** The file modal's context for a feed: the conversation, or the engagement the room belongs to. */
export function chatPreviewContext(scope: ChatFeedScope): PreviewContext {
	return scope.kind === "conversation"
		? { kind: "messages", conversationId: scope.channelId }
		: { kind: "project", projectSlug: scope.projectId || null };
}

// #endregion

// #region Tiles

/** The stored file behind a tile, or null for a fixture, a link or a connector tile. */
export function attachmentAssetId(att: Pick<MessageAttachment, "assetId">): string | null {
	return assetIdOf(att.assetId);
}

/**
 * What a tile draws. A stored image reads the proxy's `md` rendition with width-described
 * candidates; a stored video has neither a rendition nor a poster address, so it draws its
 * placeholder (the poster's BlurHash) under a play mark rather than video bytes in an `<img>`. A
 * tile with no stored bytes draws its own address: a fixture's picture, or a link's.
 */
export function attachmentPicture(att: ChatTileRef): ChatTilePicture {
	if (att.kind !== "image" && att.kind !== "video") return { src: null, srcset: null };
	const ref = tileRef(att);
	return { src: assetMediaSrc(ref, "md"), srcset: assetMediaSrcset(ref) };
}

/** The placeholder a tile paints beneath its picture, when the upload read one. */
export function attachmentPlaceholder(
	att: Pick<MessageAttachment, "blurhash">,
): ChatTilePlaceholder | undefined {
	return att.blurhash ? { blurhash: att.blurhash, color: null } : undefined;
}

/**
 * Where a tile opens in a new tab (a middle or modified click, or a click before the feed hydrates):
 * the inspector for a stored file, else the tile's own address without the rendition size the
 * bubble asked for; null when it has none.
 */
export function attachmentOpenHref(att: Pick<MessageAttachment, "assetId" | "url">): string | null {
	const id = attachmentAssetId(att);
	if (id) return fileInspectHref(id);
	const own = ownAddress(att.url);
	if (!own || !own.startsWith("/")) return own;
	const parsed = new URL(own, "https://projective.invalid");
	parsed.searchParams.delete("tier");
	const query = parsed.searchParams.toString();
	return `${parsed.pathname}${query ? `?${query}` : ""}`;
}

// #endregion

// #region Preview rows

/**
 * A message's attachments as the rows the file modal pages through, in the bubble's order.
 *
 * A row's `id` joins the message and the attachment link, so it is unique across the feed and never
 * a uuid the modal could take for a stored file; `assetId` carries the stored file. The message
 * supplies the provenance the modal's source section paints at once: sender, time and text.
 */
export function attachmentItems(message: ChatMessage, scope: ChatFeedScope): AssetItem[] {
	const sender = message.sender;
	const dateLabel = `${message.dayLabel} · ${message.timeLabel}`.slice(0, DATE_LABEL_MAX);
	return message.attachments.map((att) => {
		const assetId = attachmentAssetId(att);
		const { kind, category } = classify(att);
		const own = ownAddress(att.url);
		const visual = kind === "image" || kind === "video";
		let thumbnailUrl: string | null = null;
		if (assetId && kind === "image") thumbnailUrl = mediaProxyHref(assetId, { tier: "sm" });
		else if (!assetId && visual) thumbnailUrl = own;
		return {
			...messageAttachmentFacets(sender?.id ?? message.id),
			id: `${message.id}:${att.id}`,
			assetId,
			kind,
			category,
			name: att.name.trim() || FALLBACK_NAME,
			ext: att.ext,
			url: assetId ? mediaProxyHref(assetId) : own ?? "#",
			thumbnailUrl,
			sizeBytes: 0,
			sizeLabel: "",
			width: att.width,
			height: att.height,
			durationLabel: null,
			channelId: scope.channelId,
			channelName: null,
			channelKind: scope.kind === "conversation" ? "dm" : null,
			messageId: message.id,
			messageText: message.text.slice(0, TEXT_MAX),
			messageAudioUrl: message.audio?.url || null,
			sender: sender
				? { id: sender.id, name: sender.name, avatar: sender.avatar, handle: sender.handle }
				: null,
			createdAt: message.createdAt,
			timeLabel: message.timeLabel,
			dayLabel: message.dayLabel,
			dateLabel,
			starred: false,
		};
	});
}

// #endregion
