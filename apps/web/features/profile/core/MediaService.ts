import { getProfile, sendProfile } from "./api.ts";
import type {
	LibraryAsset,
	LibraryKind,
	LibraryPage,
	LibraryUploadComplete,
	LibraryUploadInit,
	LibraryUploadTicket,
} from "@projective/types/files";
import type { ProfileResult } from "../types/results.ts";

/**
 * MediaService — the THIN client for the caller's media library (`/api/media/*`): the listing the
 * media picker browses and the two calls either side of an upload. The bytes themselves never pass
 * through here — {@link putToTicket} sends them straight to the signed storage URL the server minted.
 */
export const MediaService = {
	/** One page of the library, newest first. */
	library(kind: LibraryKind, cursor: string | null): Promise<ProfileResult<LibraryPage>> {
		const q = new URLSearchParams({ kind });
		if (cursor) q.set("cursor", cursor);
		return getProfile<LibraryPage>(`/api/media/library?${q}`);
	},

	/** Declare a file; answers with where to put the bytes. */
	uploadInit(input: LibraryUploadInit): Promise<ProfileResult<LibraryUploadTicket>> {
		return sendProfile<LibraryUploadTicket>("/api/media/upload-init", "POST", input);
	},

	/** Ask the server to inspect, process and admit the landed bytes. */
	uploadComplete(input: LibraryUploadComplete): Promise<ProfileResult<LibraryAsset>> {
		return sendProfile<LibraryAsset>("/api/media/upload-complete", "POST", input);
	},
};

/**
 * PUT the file to the ticket's signed URL, reporting progress (0–1) when the environment can. Resolves
 * `true` when storage accepted the bytes.
 */
export function putToTicket(
	ticket: LibraryUploadTicket,
	file: Blob,
	onProgress?: (fraction: number) => void,
): Promise<boolean> {
	const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
	if (!XHR) {
		return fetch(ticket.signedUrl, { method: "PUT", headers: ticket.headers, body: file })
			.then((res) => res.ok)
			.catch(() => false);
	}
	return new Promise((resolve) => {
		const request = new XHR();
		request.open("PUT", ticket.signedUrl, true);
		for (const [name, value] of Object.entries(ticket.headers)) request.setRequestHeader(name, value);
		request.upload.onprogress = (event) => {
			if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
		};
		request.onload = () => resolve(request.status >= 200 && request.status < 300);
		request.onerror = () => resolve(false);
		request.onabort = () => resolve(false);
		request.send(file);
	});
}
