import type { JSX } from "preact";
import { type ModalStack, useFrameState } from "@projective/ui/overlay";
import type { AssetItem } from "../types/projects-types.ts";
import { FILE_FRAME_FILES, fileFrameSeed, patchFile } from "../core/file-frame.ts";
import { AttachmentPreviewModal, type PreviewContext } from "./AttachmentPreviewModal.tsx";

/** Props for {@link FileFrame}. */
export interface FileFrameProps {
	/** The modal stack the frame belongs to. */
	stack: ModalStack<string, unknown>;
	/** The frame's identity on that stack. */
	uid: number;
	/** The acting viewer's id; empty when signed out. */
	viewerId: string;
	/** The engagement's route slug. */
	projectId: string;
	context: PreviewContext;
	notesMode?: boolean;
	/** Dismiss this one frame (Escape, the scrim, the close button). */
	onClose: () => void;
	/** Called after the frame's own copy of the file is renamed. */
	onRename?: (fileId: string, name: string) => void;
	/** Called after the frame's own copy of the file is starred or unstarred. */
	onToggleStar?: (fileId: string) => void;
	onSaveNote?: (fileId: string, text: string) => void;
}

/**
 * FileFrame — the file preview rendered as a `file` frame of a modal stack (see `file-frame.ts`).
 * It pages through the group the opener cached on the frame, keeps its own optimistic copy of
 * renames and stars in the frame cache, and leaves dismissal to the stack through `onClose`.
 */
export function FileFrame(props: FileFrameProps): JSX.Element | null {
	const { stack, uid, onRename, onToggleStar } = props;
	const seed = fileFrameSeed(stack, uid);
	const files = useFrameState<AssetItem[]>(stack, uid, FILE_FRAME_FILES, seed.files);

	return (
		<AttachmentPreviewModal
			open
			files={files.value}
			startIndex={seed.startIndex}
			viewerId={props.viewerId}
			projectId={props.projectId}
			notesMode={props.notesMode}
			frame={{ stack, uid }}
			context={props.context}
			onClose={props.onClose}
			onRename={(fileId, name) => {
				files.value = patchFile(files.value, fileId, (f) => ({ ...f, name }));
				onRename?.(fileId, name);
			}}
			onToggleStar={(fileId) => {
				files.value = patchFile(files.value, fileId, (f) => ({ ...f, starred: !f.starred }));
				onToggleStar?.(fileId);
			}}
			onSaveNote={props.onSaveNote}
		/>
	);
}
