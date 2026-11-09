import type { MessageAttachmentMode } from "@projective/types/projects";
import type { CreateConversation } from "@projective/types/messaging";
import type { ShareRequest } from "./share-request.ts";
import { composeInternalMessage } from "./share-targets.ts";

/**
 * share-mode — how a file reaches somebody on Projective from the share modal (Decision #401). A
 * `link` shares the sender's own file in place: it rides the message as a link card, opens for the
 * people it was sent to, and stops when the file is set back to Only you. A `copy` hands them the
 * file to keep, as attaching it always has. Anything that is not a file is sent as its URL.
 */

/** The stored file a share request is about. */
export interface ShareFile {
	/** The `files.items` id. */
	id: string;
	/** Whether the sender may share it as a link: their own personal file. */
	canLink: boolean;
}

/** The mode a file share starts in: a link where the sender may share one, else a copy. */
export function defaultShareMode(file: ShareFile): MessageAttachmentMode {
	return file.canLink ? "link" : "copy";
}

/** The opening message one send posts: the note and the file, or the note and the URL. */
export function shareMessage(
	request: Pick<ShareRequest, "title" | "text" | "url" | "file">,
	note: string,
	mode: MessageAttachmentMode,
): Pick<CreateConversation, "message" | "attachmentIds" | "linkedFileIds"> {
	const file = request.file;
	if (!file) return { message: composeInternalMessage(request, note) };
	const message = note.trim();
	return mode === "link" && file.canLink
		? { message, linkedFileIds: [file.id] }
		: { message, attachmentIds: [file.id] };
}
