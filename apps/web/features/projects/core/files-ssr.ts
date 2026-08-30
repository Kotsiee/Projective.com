import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { FileListPage } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * files-ssr — the server-only bootstrap for the File Explorer's first paint. Calls the fat
 * {@link ProjectBackendService.files} directly (no HTTP hop) so the explorer ships its first page of
 * files + the channel index in the initial byte; the island then refines via the thin
 * {@link FilesService}. Mirrors {@link resolveMessageFeed}. Never imported by an island.
 */
export interface FileBootstrap {
	page: FileListPage | null;
}

/** Resolve the initial file page. `channelId` unset → project scope (all channels). */
export async function resolveFilePage(
	projectId: string,
	actor: ReadActor,
	channelId?: string | null,
): Promise<FileBootstrap> {
	const res = await ProjectBackendService.files({ projectId, channelId: channelId ?? null }, actor);
	return { page: res.ok && res.data ? res.data.page : null };
}
