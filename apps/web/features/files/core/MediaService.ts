import { getFiles, postFiles } from "./api.ts";
import type {
	LibraryAsset,
	LibraryUploadComplete,
	LibraryUploadInit,
	LibraryUploadTicket,
} from "@projective/types/files";
import type { OAuthAvatarSource } from "@projective/types/user";
import type { FilesResult } from "../types/results.ts";

/**
 * MediaService — the THIN client for the media pipeline's own doors (`/api/media/*`): the strict
 * quarantine upload a crop source goes through, and the caller's sign-in picture as a source. The
 * bytes never pass through here — {@link putToTicket} sends them straight to the signed storage URL
 * the server minted.
 */
export const MediaService = {
	/** Declare a file; answers with where to put the bytes. */
	uploadInit(input: LibraryUploadInit): Promise<FilesResult<LibraryUploadTicket>> {
		return postFiles<LibraryUploadTicket>("/api/media/upload-init", input);
	},

	/** Ask the server to inspect, process and admit the landed bytes. */
	uploadComplete(input: LibraryUploadComplete): Promise<FilesResult<LibraryAsset>> {
		return postFiles<LibraryAsset>("/api/media/upload-complete", input);
	},

	/** Which provider the caller signed in with, and its picture, before anything is copied. */
	oauthAvatar(): Promise<FilesResult<OAuthAvatarSource>> {
		return getFiles<OAuthAvatarSource>("/api/media/oauth-avatar-sync");
	},

	/** Copy the sign-in picture into the library through the pipeline; answers with the new asset. */
	syncOAuthAvatar(): Promise<FilesResult<LibraryAsset>> {
		return postFiles<LibraryAsset>("/api/media/oauth-avatar-sync", {});
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
		for (const [name, value] of Object.entries(ticket.headers)) {
			request.setRequestHeader(name, value);
		}
		request.upload.onprogress = (event) => {
			if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
		};
		request.onload = () => resolve(request.status >= 200 && request.status < 300);
		request.onerror = () => resolve(false);
		request.onabort = () => resolve(false);
		request.send(file);
	});
}
