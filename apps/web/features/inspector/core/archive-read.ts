/// <reference lib="dom" />
import type { ArchiveMember } from "./archive-tree.ts";
import { openRemoteZip } from "./remote-zip.ts";
import { listTar } from "./tar-list.ts";

/**
 * archive-read — an archive's table of contents, whichever format it is. Nothing is extracted, and a
 * ZIP of any size lists from its last few kilobytes. A tar has no directory, so it has to be walked,
 * but the walk keeps no payload and stops at the listing's ceiling.
 */

/** A format this viewer can list. */
export type ArchiveFormat = "zip" | "tar" | "tgz";

/** The listing format a file's name says it is. */
export function archiveFormat(name: string): ArchiveFormat | null {
	const lower = name.toLowerCase();
	if (lower.endsWith(".zip")) return "zip";
	if (lower.endsWith(".tar")) return "tar";
	if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tgz";
	return null;
}

/** What a listing found. */
export interface ArchiveListing {
	members: ArchiveMember[];
	truncated: boolean;
}

/** List an archive at a same-origin address. Rejects when its bytes are not what its name says. */
export async function readArchive(
	src: string,
	sizeBytes: number,
	format: ArchiveFormat,
	signal?: AbortSignal,
): Promise<ArchiveListing> {
	if (format === "zip") {
		const zip = await openRemoteZip(src, sizeBytes, signal);
		return { members: [...zip.entries], truncated: false };
	}
	const res = await fetch(src, { signal, credentials: "same-origin" });
	if (!res.ok || !res.body) {
		await res.body?.cancel();
		throw new Error("This file couldn't be loaded.");
	}
	const stream = format === "tgz"
		? res.body.pipeThrough(new DecompressionStream("gzip"))
		: res.body;
	const { entries, truncated } = await listTar(stream as ReadableStream<Uint8Array>);
	return { members: entries, truncated };
}
