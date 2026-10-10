import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import "../styles/attachment-modal.css";
import { usePresence } from "@projective/ui/overlay";
import { useId } from "@projective/ui/hooks";
import type { AssetItem } from "../types/projects-types.ts";
import type { PreviewContext } from "./preview/preview-model.ts";
import { type PreviewFrame, PreviewSession } from "./preview/PreviewSession.tsx";
import { PreviewShell } from "./preview/PreviewShell.tsx";

export type { PreviewContext } from "./preview/preview-model.ts";
export type { PreviewFrame } from "./preview/PreviewSession.tsx";

/** Props for {@link AttachmentPreviewModal}. */
export interface AttachmentPreviewModalProps {
	open: boolean;
	/** The group the preview pages through (siblings sharing a post, or the open folder). */
	files: AssetItem[];
	/** The index within `files` the modal opens on. */
	startIndex: number;
	/** The acting viewer's id: a posted file is renamed by its sender only; empty when signed out. */
	viewerId: string;
	/** The engagement's route slug (the conversation id in a conversation's files). */
	projectId: string;
	/** Submissions: a review-notes area in the side panel. */
	notesMode?: boolean;
	onClose: () => void;
	onRename: (fileId: string, name: string) => void;
	onToggleStar: (fileId: string) => void;
	/** Persist a review note; the modal also keeps the session's notes itself. */
	onSaveNote?: (fileId: string, text: string) => void;
	/** When rendered as a frame of a modal stack: state is cached per frame and the stack owns dismissal. */
	frame?: PreviewFrame;
	/** Where the modal was opened — drives the source-message section and "Go to message". */
	context?: PreviewContext;
	/** Same-surface jump (e.g. inside ChatFeed): called instead of navigating. */
	onGoToMessage?: (messageId: string) => void;
	/** Optional DOM element to return focus to on close (else the trigger that had focus). */
	returnFocusTo?: HTMLElement | null;
}

/**
 * AttachmentPreviewModal — the universal file preview. A stored file opens in the inspector's own
 * canvas (zoom, pages, playback, find…) with its controls and facts in a resizable side panel; a
 * fixture, link or connector file falls back to {@link FilePreview}. The header names the file and
 * carries star, download, copy link, open in a new tab and close; a group pages through a thumbnail
 * tray; the message a file was shared in sits in the side panel with "Go to message". Below
 * `--bp-md` the panel is fullscreen and the side panel becomes a swipeable sheet.
 *
 * Hand-rolled (`BodyPortal` → scrim → panel) rather than `Dialog`, which caps the width and pads its
 * body (Decision #67(C)). As a frame of a modal stack (`frame`) it replaces the modal beneath it, keeps
 * its state in the frame cache, and leaves dismissal to the stack's host through `onClose`.
 */
export function AttachmentPreviewModal(props: AttachmentPreviewModalProps): JSX.Element | null {
	const { open, files, frame, onClose, returnFocusTo } = props;
	const { mounted, state } = usePresence(open);
	const titleId = useId(undefined, "fx-preview-title");
	const stageRef = useRef<HTMLDivElement>(null);

	if (!mounted || files.length === 0) return null;
	const session = frame ? `frame-${frame.uid}` : files.map((f) => f.id).join("|");

	return (
		<PreviewShell
			state={state}
			framed={frame !== undefined}
			labelledBy={titleId}
			onDismiss={onClose}
			initialFocusRef={stageRef}
			returnFocusTo={returnFocusTo}
		>
			<PreviewSession
				key={session}
				files={files}
				startIndex={props.startIndex}
				viewerId={props.viewerId}
				projectId={props.projectId}
				notesMode={props.notesMode ?? false}
				onClose={onClose}
				onRename={props.onRename}
				onToggleStar={props.onToggleStar}
				onSaveNote={props.onSaveNote}
				frame={frame}
				context={props.context}
				onGoToMessage={props.onGoToMessage}
				titleId={titleId}
				stageRef={stageRef}
			/>
		</PreviewShell>
	);
}
