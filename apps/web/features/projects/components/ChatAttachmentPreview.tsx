import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { AssetItem, ChatMessage } from "../types/projects-types.ts";
import {
	attachmentItems,
	type ChatFeedScope,
	chatPreviewContext,
} from "../core/chat-attachments.ts";
import { AttachmentPreviewModal } from "./AttachmentPreviewModal.tsx";

/** One request to preview a message's attachments. */
export interface ChatPreviewRequest {
	/** The message whose attachments the preview pages through. */
	messageId: string;
	/** The attachment it opens on. */
	index: number;
	/** The tile that opened it; focus returns there on close. */
	trigger: HTMLElement | null;
}

/** Props for {@link ChatAttachmentPreview}. */
export interface ChatAttachmentPreviewProps {
	/** The open request; the feed writes it, the preview clears it on close. */
	request: Signal<ChatPreviewRequest | null>;
	/** The feed's loaded messages, the one requested among them. */
	messages: readonly ChatMessage[];
	scope: ChatFeedScope;
	/** Scroll the feed to a message and flash it (the preview's "Go to message"). */
	onGoToMessage: (messageId: string) => void;
}

/** Stands in for the viewer's id until one of their own messages names it; never a real id. */
const UNKNOWN_VIEWER = "viewer";

/**
 * ChatAttachmentPreview — the file preview a chat feed opens from a bubble's tiles: the message's
 * attachments as one group, its sender and text as the source the side panel paints at once, and
 * "Go to message" as a jump inside the same feed. Renames and stars are kept for the session, as the
 * file explorer keeps them.
 */
export function ChatAttachmentPreview(
	{ request, messages, scope, onGoToMessage }: ChatAttachmentPreviewProps,
): JSX.Element | null {
	const names = useSignal<Readonly<Record<string, string>>>({});
	const starred = useSignal<Readonly<Record<string, boolean>>>({});
	const last = useRef<ChatPreviewRequest | null>(null);

	const current = request.value;
	if (current) last.current = current;
	const shown = last.current;
	if (!shown) return null;

	const message = messages.find((m) => m.id === shown.messageId);
	const files: AssetItem[] = message
		? attachmentItems(message, scope).map((file) => ({
			...file,
			name: names.value[file.id] ?? file.name,
			starred: starred.value[file.id] ?? file.starred,
		}))
		: [];
	const viewerId = messages.find((m) => m.isOwn && m.sender)?.sender?.id ?? UNKNOWN_VIEWER;

	return (
		<AttachmentPreviewModal
			open={current !== null && files.length > 0}
			files={files}
			startIndex={shown.index}
			viewerId={viewerId}
			projectId={scope.projectId}
			context={chatPreviewContext(scope)}
			returnFocusTo={shown.trigger}
			onClose={() => (request.value = null)}
			onRename={(fileId, name) => (names.value = { ...names.value, [fileId]: name })}
			onToggleStar={(fileId) => {
				const file = files.find((f) => f.id === fileId);
				starred.value = { ...starred.value, [fileId]: !(file?.starred ?? false) };
			}}
			onGoToMessage={onGoToMessage}
		/>
	);
}
