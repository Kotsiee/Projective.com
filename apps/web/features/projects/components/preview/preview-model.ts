import {
	assetIdOf,
	type AssetItem,
	fileInspectHref,
	type FileKind,
	inspectable,
	type InspectAsset,
	type InspectViewer,
	mediaProxyHref,
} from "@projective/types/files";
import { type AttachmentSource, attachmentSourceExcerpt } from "@projective/types/projects";

/**
 * preview-model — the preview modal's pure rules: which asset id a row reads its bytes by, where the
 * modal was opened from, the header's glyph and meta line, the source message it can paint before
 * the reverse lookup answers, and what "Go to message" does. DOM-free and tested.
 */

// #region Types

/** Where the preview was opened — drives the source-message section and "Go to message". */
export type PreviewContext =
	| { kind: "messages"; conversationId: string }
	| { kind: "project"; projectSlug: string | null }
	| { kind: "files" }
	| { kind: "submission" }
	| { kind: "ticket" };

/** The slice of a row the modal's rules read. */
export type PreviewFile = Pick<
	AssetItem,
	| "id"
	| "assetId"
	| "source"
	| "status"
	| "kind"
	| "ext"
	| "url"
	| "thumbnailUrl"
	| "sizeBytes"
	| "sizeLabel"
	| "width"
	| "height"
	| "durationLabel"
	| "channelId"
	| "channelName"
	| "channelKind"
	| "messageId"
	| "messageText"
	| "sender"
	| "createdAt"
	| "dayLabel"
	| "timeLabel"
	| "link"
>;

/** The glyphs the header's category mark can draw; every one is a registered `IconName`. */
export type PreviewIconName =
	| "image"
	| "video"
	| "volume"
	| "page-single"
	| "document"
	| "code-brackets"
	| "table-grid"
	| "cube-3d"
	| "font-type"
	| "archive-box"
	| "link"
	| "attachment";

/** A source message as the aside paints it: `href` is null until a route for it is known. */
export type SourcePaint = Omit<AttachmentSource, "href"> & { href: string | null };

/** What "Go to message" does: scroll the feed the modal sits over, or load the message's page. */
export type GoToMessageMode = "jump" | "navigate";

// #endregion

// #region Identity

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `files.items` id the proxy and the inspector read a row by; null when nothing is stored. */
export function previewAssetId(
	file: Pick<AssetItem, "id" | "assetId" | "source" | "status">,
): string | null {
	if (!inspectable(file)) return null;
	return assetIdOf(file.assetId ?? file.id);
}

/** The share slug a row's own same-origin address carries (a shared-folder row), if any. */
export function previewShareOf(file: Pick<AssetItem, "url" | "thumbnailUrl">): string | null {
	for (const href of [file.url, file.thumbnailUrl]) {
		if (!href || !href.startsWith("/")) continue;
		const query = href.indexOf("?");
		if (query < 0) continue;
		const share = new URLSearchParams(href.slice(query + 1)).get("share");
		if (share) return share;
	}
	return null;
}

/** The inspector page for a row with stored bytes; null otherwise. */
export function previewInspectHref(
	file: Pick<AssetItem, "id" | "assetId" | "source" | "status" | "url" | "thumbnailUrl">,
): string | null {
	const id = previewAssetId(file);
	return id ? fileInspectHref(id, { share: previewShareOf(file) }) : null;
}

/** The download address: the proxy as an attachment for stored bytes, else the row's own file. */
export function previewDownloadHref(
	file: Pick<AssetItem, "id" | "assetId" | "source" | "status" | "url" | "thumbnailUrl">,
): string | null {
	const id = previewAssetId(file);
	if (id) return mediaProxyHref(id, { download: true, share: previewShareOf(file) });
	if (file.source === "link") return null;
	const own = file.url.trim();
	return own === "" || own === "#" ? null : own;
}

// #endregion

// #region Paging

/** `index` kept inside a set of `count` files (0 for an empty set). */
export function clampPage(index: number, count: number): number {
	if (count <= 0 || !Number.isFinite(index)) return 0;
	return Math.min(Math.max(0, Math.trunc(index)), count - 1);
}

/** One step through the set without wrapping. */
export function stepPage(index: number, delta: number, count: number): number {
	return clampPage(clampPage(index, count) + delta, count);
}

/** A posted file is renamed by its sender only; an uploaded one by whoever may manage it. */
export function canRenameFile(
	file: Pick<AssetItem, "sender" | "canManage">,
	viewerId: string,
): boolean {
	return file.sender ? file.sender.id === viewerId && viewerId !== "" : file.canManage;
}

// #endregion

// #region Context

/**
 * The context a mount named, else the one its rows imply: a DM row (or a conversation-scoped row,
 * whose channel is the conversation the explorer was opened on) is a message thread; a posted row
 * is a project channel; anything else is the library.
 */
export function resolvePreviewContext(
	context: PreviewContext | undefined,
	file: Pick<AssetItem, "channelId" | "channelKind" | "messageId">,
	projectId: string,
): PreviewContext {
	if (context) return context;
	const channel = file.channelId;
	if (channel && (file.channelKind === "dm" || channel === projectId)) {
		return { kind: "messages", conversationId: channel };
	}
	if (channel && file.messageId) return { kind: "project", projectSlug: projectId || null };
	return { kind: "files" };
}

/** The reverse lookup to run for a row: its asset id and the conversation to narrow to, or null. */
export function sourceLookup(
	file: Pick<AssetItem, "id" | "assetId" | "source" | "status" | "channelId">,
	context: PreviewContext,
): { assetId: string; conversationId: string | null } | null {
	if (context.kind === "submission") return null;
	const assetId = previewAssetId(file);
	if (!assetId) return null;
	if (context.kind === "messages") return { assetId, conversationId: context.conversationId };
	const channel = file.channelId;
	return { assetId, conversationId: channel && UUID.test(channel) ? channel : null };
}

function dmMessageHref(conversationId: string, messageId: string): string {
	return `/messages/${encodeURIComponent(conversationId)}?m=${encodeURIComponent(messageId)}`;
}

function roomMessageHref(projectSlug: string, room: string, messageId: string): string {
	return `/projects/${encodeURIComponent(projectSlug)}/${encodeURIComponent(room)}/chat?m=${
		encodeURIComponent(messageId)
	}`;
}

/**
 * The source message a posted row already describes, painted before the lookup answers. A project
 * room addressed by a uuid gets no route yet: rooms route by slug (Decision #88), and only the
 * lookup knows it.
 */
export function sourceFromFile(file: PreviewFile, context: PreviewContext): SourcePaint | null {
	if (!file.messageId || !file.sender) return null;
	const conversationId = file.channelId;
	let href: string | null = null;
	if (context.kind === "messages") {
		href = dmMessageHref(context.conversationId, file.messageId);
	} else if (
		context.kind === "project" && context.projectSlug && conversationId &&
		!UUID.test(conversationId)
	) {
		href = roomMessageHref(context.projectSlug, conversationId, file.messageId);
	}
	return {
		messageId: file.messageId,
		kind: context.kind === "messages" || file.channelKind === "dm" ? "dm" : "project",
		conversationId,
		channelLabel: file.channelKind === "dm" ? null : file.channelName,
		sender: {
			id: file.sender.id,
			name: file.sender.name,
			handle: file.sender.handle,
			avatarSrc: file.sender.avatar,
		},
		createdAt: file.createdAt,
		dayLabel: file.dayLabel,
		timeLabel: file.timeLabel,
		excerpt: attachmentSourceExcerpt(file.messageText),
		href,
	};
}

/**
 * The source the aside shows: the lookup's row for the message the file came from, else its newest;
 * the row's own paint while the lookup is pending or finds nothing.
 */
export function pickSource(
	fetched: readonly AttachmentSource[] | null,
	instant: SourcePaint | null,
	messageId: string | null,
): SourcePaint | null {
	if (fetched && fetched.length > 0) {
		return fetched.find((s) => s.messageId === messageId) ?? fetched[0];
	}
	return instant;
}

/**
 * "Go to message": a jump inside the feed the modal sits over when that feed holds the message (the
 * file was opened from it), else a navigation; null when neither can reach it.
 */
export function goToMessageMode(
	source: SourcePaint,
	fileMessageId: string | null,
	canJump: boolean,
): GoToMessageMode | null {
	if (canJump && fileMessageId !== null && source.messageId === fileMessageId) return "jump";
	return source.href ? "navigate" : null;
}

// #endregion

// #region Shortcuts

/** A key the side panel lists, in the inspector's `ViewerShortcut` shape. */
export interface PreviewShortcut {
	keys: string[];
	label: string;
}

/** The canvas's own shortcuts, then the modal's: paging (for a group) and closing. */
export function previewShortcuts(
	canvas: readonly PreviewShortcut[],
	paging: boolean,
): PreviewShortcut[] {
	const modal: PreviewShortcut[] = paging
		? [
			{ keys: ["←"], label: "Previous file (in the header or file strip)" },
			{ keys: ["→"], label: "Next file (in the header or file strip)" },
		]
		: [];
	return [...canvas, ...modal, { keys: ["Esc"], label: "Close the preview" }];
}

// #endregion

// #region Header

const KIND_ICONS: Readonly<Record<FileKind, PreviewIconName>> = {
	image: "image",
	video: "video",
	audio: "volume",
	pdf: "page-single",
	doc: "document",
	code: "code-brackets",
	archive: "archive-box",
	link: "link",
	file: "attachment",
};

const VIEWER_ICONS: Readonly<Partial<Record<InspectViewer, PreviewIconName>>> = {
	image: "image",
	svg: "image",
	video: "video",
	audio: "volume",
	pdf: "page-single",
	markdown: "document",
	text: "document",
	docx: "document",
	code: "code-brackets",
	table: "table-grid",
	model: "cube-3d",
	font: "font-type",
};

/** The category glyph: by the canvas that draws the file when known, else by its kind. */
export function previewIconName(kind: FileKind, viewer?: InspectViewer | null): PreviewIconName {
	return (viewer ? VIEWER_ICONS[viewer] : undefined) ?? KIND_ICONS[kind] ?? "attachment";
}

/**
 * The header's meta line, `Format · Size · W × H` (or the duration): the inspector's facts when
 * loaded, else the row's own. When neither stores a shape, the canvas's discovered `Resolution` or
 * `Duration` fact fills it. A link shows its host instead of a size it does not have.
 */
export function previewMetaLine(
	file: Pick<
		PreviewFile,
		"ext" | "kind" | "sizeLabel" | "sizeBytes" | "width" | "height" | "durationLabel" | "link"
	>,
	asset?: Pick<InspectAsset, "ext" | "sizeLabel" | "width" | "height" | "durationLabel"> | null,
	discovered?: readonly { label: string; value: string }[],
): string {
	if (file.kind === "link") return file.link?.domain ?? "";
	const ext = (asset?.ext ?? file.ext).trim().toUpperCase();
	const size = asset ? asset.sizeLabel : file.sizeBytes > 0 ? file.sizeLabel : "";
	const width = asset ? asset.width : file.width;
	const height = asset ? asset.height : file.height;
	const duration = asset ? asset.durationLabel : file.durationLabel;
	const fact = (label: string) => discovered?.find((f) => f.label === label)?.value ?? null;
	const shape = width !== null && height !== null
		? `${width} × ${height}`
		: duration ?? fact("Resolution")?.replace(/\s*px$/, "") ?? fact("Duration") ?? "";
	return [ext, size.trim(), shape].filter((part) => part.length > 0).join(" · ");
}

// #endregion
