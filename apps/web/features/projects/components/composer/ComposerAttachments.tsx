import { cloneElement, type JSX } from "preact";
import { type ReadonlySignal, type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { AssetItem } from "@web/features/files/types/file-types.ts";
import type { MessageReplyDetail } from "@web/utils/lane-events.ts";
import { CloseIcon } from "../glyphs.tsx";
import { ReplyIcon } from "../chat-glyphs.tsx";
import { FileTypeGlyph } from "../composer-glyphs.tsx";
import {
	extOf,
	fileKindOf,
	formatBytes,
	makeId,
	MAX_ATTACHMENTS,
} from "../../core/composer-model.ts";
import type { DraftAttachment, PastedBlock } from "../../types/composer-types.ts";

// #region Staging helpers
/**
 * Stage device files onto the tray, up to the room left under {@link MAX_ATTACHMENTS}.
 *
 * Returns the new cards to append, or `null` when there is nothing to stage (no files, or a full
 * tray). Image and video files get an object-URL preview this composer owns and later revokes.
 */
export function stageDeviceFiles(
	list: FileList | File[],
	current: DraftAttachment[],
): DraftAttachment[] | null {
	const incoming = Array.from(list);
	if (incoming.length === 0) return null;
	const room = MAX_ATTACHMENTS - current.length;
	if (room <= 0) return null;
	const next: DraftAttachment[] = [];
	for (const file of incoming.slice(0, room)) {
		const kind = fileKindOf(file.name, file.type);
		const previewUrl = kind === "image" || kind === "video" ? URL.createObjectURL(file) : undefined;
		next.push({
			id: makeId("att"),
			file,
			assetId: null,
			name: file.name,
			size: file.size,
			ext: extOf(file.name),
			kind,
			previewUrl,
		});
	}
	return next;
}

/**
 * Stage assets the viewer already has, from the Asset Picker.
 *
 * **Nothing is uploaded and nothing is copied.** A library pick is a reference: the bytes are
 * already on the platform, and re-uploading them would spend the person's storage allowance twice
 * for one file and give the same content two identities.
 *
 * The same-file guard is by ASSET id rather than by name: two different files can share a name,
 * and the same file picked twice is the case worth refusing. Returns `null` when there is nothing
 * to do (no assets, or a full tray).
 */
export function stageLibraryAssets(
	assets: AssetItem[],
	current: DraftAttachment[],
): DraftAttachment[] | null {
	if (assets.length === 0) return null;
	const room = MAX_ATTACHMENTS - current.length;
	if (room <= 0) return null;
	const staged = new Set(
		current.map((a) => a.assetId).filter((id): id is string => id !== null),
	);
	const next: DraftAttachment[] = [];
	for (const asset of assets) {
		if (next.length >= room) break;
		if (staged.has(asset.id)) continue;
		const kind = fileKindOf(asset.name, asset.ext);
		next.push({
			id: makeId("att"),
			file: null,
			assetId: asset.id,
			name: asset.name,
			size: asset.sizeBytes,
			ext: asset.ext,
			kind,
			// The asset's OWN thumbnail. Not an object URL, which is why the revoke paths check
			// `assetId` first — revoking a remote URL is meaningless, and treating it as ours is how a
			// preview that other cards also point at goes blank.
			previewUrl: kind === "image" || kind === "video"
				? asset.thumbnailUrl ?? asset.url
				: undefined,
		});
	}
	return next;
}

/** Revoke a preview URL only when the composer minted it (see {@link stageLibraryAssets}). */
export function releasePreview(attachment: DraftAttachment): void {
	if (attachment.assetId !== null || !attachment.previewUrl) return;
	try {
		URL.revokeObjectURL(attachment.previewUrl);
	} catch { /* already revoked */ }
}
// #endregion

// #region Drag & drop
/** The drop-zone state and handlers {@link useFileDrop} hands to the composer root. */
export interface FileDropZone {
	/** Files are being dragged over the composer. */
	dragActive: ReadonlySignal<boolean>;
	onDragEnter: (event: JSX.TargetedDragEvent<HTMLDivElement>) => void;
	onDragOver: (event: JSX.TargetedDragEvent<HTMLDivElement>) => void;
	onDragLeave: (event: JSX.TargetedDragEvent<HTMLDivElement>) => void;
	onDrop: (event: JSX.TargetedDragEvent<HTMLDivElement>) => void;
}

/**
 * Drag-and-drop onto the composer. A depth counter keeps nested enter/leave pairs from flickering the
 * overlay; a drop hands its files to `onFiles`.
 */
export function useFileDrop(onFiles: (files: FileList) => void): FileDropZone {
	const dragActive = useSignal(false);
	const dragDepth = useRef(0);
	function onDragEnter(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
		event.preventDefault();
		dragDepth.current += 1;
		dragActive.value = true;
	}
	function onDragOver(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
		event.preventDefault();
	}
	function onDragLeave(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
		event.preventDefault();
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) dragActive.value = false;
	}
	function onDrop(event: JSX.TargetedDragEvent<HTMLDivElement>): void {
		event.preventDefault();
		dragDepth.current = 0;
		dragActive.value = false;
		if (event.dataTransfer?.files) onFiles(event.dataTransfer.files);
	}
	return { dragActive, onDragEnter, onDragOver, onDragLeave, onDrop };
}
// #endregion

// #region Reply strip
/** Props for {@link ComposerReplyStrip}. */
export interface ComposerReplyStripProps {
	/** The message being replied to; the strip renders nothing while it is null. */
	replyTo: Signal<MessageReplyDetail["target"] | null>;
}

/**
 * The reply strip — who is being answered and what they said, until the reply goes or is
 * cancelled. A control (it cancels), so it takes the tonal chip treatment the paste chips use rather
 * than a bordered box.
 */
export function ComposerReplyStrip({ replyTo }: ComposerReplyStripProps): JSX.Element | null {
	const target = replyTo.value;
	if (!target) return null;
	return (
		<div class="chat-composer__reply">
			<span class="chat-composer__reply-icon" aria-hidden="true">
				{cloneElement(ReplyIcon)}
			</span>
			<span class="chat-composer__reply-meta">
				<span class="chat-composer__reply-title">
					Replying to {target.isOwn ? "yourself" : target.senderName ?? "a message"}
				</span>
				<span class="chat-composer__reply-text">
					{target.excerpt ||
						(target.media === "audio"
							? "Voice message"
							: target.media === "attachment"
							? "Attachment"
							: "Message")}
				</span>
			</span>
			<button
				type="button"
				class="chat-composer__paste-remove"
				aria-label="Cancel reply"
				onClick={() => (replyTo.value = null)}
			>
				{CloseIcon}
			</button>
		</div>
	);
}
// #endregion

// #region Attachment tray
/** Props for {@link ComposerAttachments}. */
export interface ComposerAttachmentsProps {
	/** The staged attachment cards (max {@link MAX_ATTACHMENTS}). */
	attachments: Signal<DraftAttachment[]>;
	/** The collapsed long-paste blocks. */
	pasted: Signal<PastedBlock[]>;
	/** Remove one card from the tray by its draft id. */
	onRemoveAttachment: (id: string) => void;
	/** Remove one collapsed paste block by its id. */
	onRemovePasted: (id: string) => void;
}

/**
 * The composer's attachment tray: the preview cards for staged files (an image or video previews
 * itself, anything else shows its type glyph) followed by the collapsed long-paste chips. Each item
 * carries its own remove control.
 */
export function ComposerAttachments(
	{ attachments, pasted, onRemoveAttachment, onRemovePasted }: ComposerAttachmentsProps,
): JSX.Element {
	return (
		<>
			{/* Attachment preview cards (max 10). */}
			{attachments.value.length > 0 && (
				<ul class="chat-composer__cards" aria-label="Attachments">
					{attachments.value.map((att) => (
						<li key={att.id} class="chat-composer__card" data-kind={att.kind}>
							{att.kind === "image" && att.previewUrl
								? <img class="chat-composer__card-media" src={att.previewUrl} alt={att.name} />
								: att.kind === "video" && att.previewUrl
								? (
									<video
										class="chat-composer__card-media"
										src={att.previewUrl}
										muted
										playsInline
										preload="metadata"
									/>
								)
								: (
									<span class="chat-composer__card-file" aria-hidden="true">
										<FileTypeGlyph ext={att.ext} />
										{att.ext && <span class="chat-composer__card-ext">{att.ext}</span>}
									</span>
								)}
							<span
								class="chat-composer__card-name"
								title={`${att.name} · ${formatBytes(att.size)}`}
							>
								{att.name}
							</span>
							<button
								type="button"
								class="chat-composer__card-remove"
								aria-label={`Remove ${att.name}`}
								onClick={() =>
									onRemoveAttachment(att.id)}
							>
								{CloseIcon}
							</button>
						</li>
					))}
				</ul>
			)}

			{/* Collapsed long-paste chips. */}
			{pasted.value.map((block) => (
				<div key={block.id} class="chat-composer__paste">
					<span class="chat-composer__paste-glyph" aria-hidden="true">
						<FileTypeGlyph ext="txt" />
					</span>
					<span class="chat-composer__paste-meta">
						<span class="chat-composer__paste-title">Pasted text</span>
						<span class="chat-composer__paste-sub">
							{block.lines} lines · {block.chars.toLocaleString()} chars
						</span>
					</span>
					<button
						type="button"
						class="chat-composer__paste-remove"
						aria-label="Remove pasted text"
						onClick={() => onRemovePasted(block.id)}
					>
						{CloseIcon}
					</button>
				</div>
			))}
		</>
	);
}
// #endregion
