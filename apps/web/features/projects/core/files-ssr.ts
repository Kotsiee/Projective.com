import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { FileChannelRef, FileListPage } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import { once } from "@web/utils/request-memo.ts";
import {
	type FileChannelRoutes,
	fileChannelRoutes,
	type FileTreeSelection,
	roomOfRef,
	selectionOfSearch,
	selectionTitle,
} from "./file-tree-route.ts";

/**
 * files-ssr — the server-only bootstrap for the File Explorer's first paint. Calls the fat
 * {@link ProjectBackendService.files} directly (no HTTP hop) so the explorer ships its first page of
 * files + the channel index in the initial byte; the island then refines via the thin
 * {@link FilesService}. Mirrors {@link resolveMessageFeed}. Never imported by an island.
 */
export interface FileBootstrap {
	page: FileListPage | null;
}

/**
 * Resolve the initial file page. `channelId` unset → project scope (all channels); `projectFiles` →
 * the client's project files alone.
 */
export async function resolveFilePage(
	projectId: string,
	actor: ReadActor,
	channelId?: string | null,
	projectFiles = false,
): Promise<FileBootstrap> {
	const res = await ProjectBackendService.files(
		{ projectId, channelId: channelId ?? null, projectFiles: projectFiles || undefined },
		actor,
	);
	return { page: res.ok && res.data ? res.data.page : null };
}

// #region The explorer route's first paint
/** The project-scope tree's index: every room with files, the client's project files, the Task flag. */
export interface FileTreeIndex {
	channels: FileChannelRef[];
	projectFileCount: number;
	task: boolean;
}

/**
 * Everything a project's Files route — or one channel's — paints first (Decision #317): the page, the
 * tree node it shows, the room → address map the tree builds its links and `?in=` from, the tree's
 * index, and the node's title for the header band.
 */
export interface FileExplorerBootstrap {
	page: FileListPage | null;
	selection: FileTreeSelection;
	routes: FileChannelRoutes;
	index: FileTreeIndex | null;
	title: string;
}

/** The project-scope index alone — one row of page, the whole channel set. */
async function readIndex(projectId: string, actor: ReadActor): Promise<FileTreeIndex | null> {
	const res = await ProjectBackendService.files({ projectId, channelId: null, limit: 1 }, actor);
	if (!res.ok || !res.data) return null;
	const { channels, projectFileCount, task } = res.data.page;
	return { channels, projectFileCount, task };
}

/**
 * The explorer's first paint for this request, read once: the route and the header band slot both
 * ask (the shared request memo).
 *
 * On `/projects/{project}/files` the node comes from `?in=`. A narrowed node (Project files, one
 * channel) still needs the WHOLE index, because the server answers a channel read with that channel
 * alone — so the index is read beside it and the tree keeps every room. On a channel's own route the
 * channel is the node and the index is read for the tree's links.
 */
export function resolveFileExplorer(
	url: URL,
	projectId: string,
	actor: ReadActor,
	channelRef: string | null = null,
): Promise<FileExplorerBootstrap> {
	const key = `files|explorer|${projectId}|${channelRef ?? ""}|${actor.userId}|${actor.contextId}`;
	return once(url, key, async (): Promise<FileExplorerBootstrap> => {
		const detail = await ProjectBackendService.detail(projectId, actor);
		const routes = detail.ok && detail.data ? fileChannelRoutes(detail.data.detail) : {};
		const selection: FileTreeSelection = channelRef
			? { kind: "channel", id: roomOfRef(routes, channelRef) }
			: selectionOfSearch(url.search, routes);
		const narrowed = selection.kind !== "all";
		const [{ page }, index] = await Promise.all([
			resolveFilePage(
				projectId,
				actor,
				channelRef ?? (selection.kind === "channel" ? routes[selection.id] ?? selection.id : null),
				!channelRef && selection.kind === "project",
			),
			narrowed ? readIndex(projectId, actor) : Promise.resolve(null),
		]);
		const resolved: FileTreeSelection = selection.kind === "channel" && page?.channelId
			? { kind: "channel", id: page.channelId }
			: selection;
		const merged = page && index && !channelRef
			? {
				...page,
				channels: index.channels,
				projectFileCount: index.projectFileCount,
				task: index.task,
			}
			: page;
		const treeIndex = index ??
			(page
				? { channels: page.channels, projectFileCount: page.projectFileCount, task: page.task }
				: null);
		return {
			page: merged,
			selection: resolved,
			routes,
			index: treeIndex,
			title: selectionTitle(resolved, treeIndex?.channels ?? []),
		};
	});
}
// #endregion
