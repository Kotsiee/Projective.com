import { formatMib, MIB, type UploadTask } from "../types/file-types.ts";

/**
 * upload-tasks — turning picked files into upload-queue tasks, shared by every control that takes a
 * file in (the `/files` footer rig, a console drive's Upload) so the queue's task shape has one
 * author. Pure apart from minting a key.
 */

// #region Tasks
/** A client-minted queue key. `randomUUID` needs a secure context, so there is a plain fallback. */
export function queueKey(): string {
	try {
		return globalThis.crypto?.randomUUID?.() ?? `q-${Date.now()}-${Math.random().toString(36)}`;
	} catch {
		return `q-${Date.now()}-${Math.random().toString(36)}`;
	}
}

/**
 * One `queued` task per picked file, bound for `folderId` (`null` = the library root). A task exists
 * from the moment a file is picked — before the server has minted anything to key it on — so each
 * carries its own client key.
 */
export function uploadTasksOf(files: readonly File[], folderId: string | null): UploadTask[] {
	return files.map((file) => ({
		id: queueKey(),
		file,
		name: file.name,
		sizeBytes: file.size,
		sizeLabel: formatMib(file.size / MIB),
		mimeType: file.type || "application/octet-stream",
		folderId,
		phase: "queued",
		progress: 0,
		fingerprint: null,
		verdict: null,
		resolution: null,
		assetId: null,
		ticket: null,
		error: null,
	}));
}
// #endregion
