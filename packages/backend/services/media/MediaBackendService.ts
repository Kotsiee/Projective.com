import type { ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import type {
	LibraryAsset,
	LibraryListParams,
	LibraryPage,
	LibraryUploadComplete,
	LibraryUploadInit,
	LibraryUploadTicket,
} from "@projective/types/files";
import { completeLibraryUpload, initLibraryUpload, listLibrary } from "./library.ts";

/**
 * MediaBackendService — the FAT service behind a person's media library: the listing the media
 * picker browses and the quarantine upload that adds to it (see `./library.ts` for the flow).
 *
 * Always live. The library is the caller's own files, read and written under their own session;
 * there is no fixture branch, because a picker that showed files the person never uploaded would be
 * showing somebody else's life.
 */
export class MediaBackendService {
	/** One page of the caller's library, newest first. */
	static async library(actor: ReadActor, params: LibraryListParams): Promise<ServiceResult<LibraryPage>> {
		return await listLibrary(actor, params);
	}

	/** Declare an upload: records it and answers with the signed URL the bytes go to. */
	static async uploadInit(
		actor: ReadActor,
		input: LibraryUploadInit,
	): Promise<ServiceResult<LibraryUploadTicket>> {
		return await initLibraryUpload(actor, input);
	}

	/** Inspect, process and admit an upload that has landed in quarantine. */
	static async uploadComplete(
		actor: ReadActor,
		input: LibraryUploadComplete,
	): Promise<ServiceResult<LibraryAsset>> {
		return await completeLibraryUpload(actor, input);
	}
}
