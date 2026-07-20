import { define } from "@web/utils/state.ts";
import { resolveFilePage } from "@web/features/projects/core/files-ssr.ts";
import FileExplorer from "@web/features/projects/islands/FileExplorer.island.tsx";

/**
 * Files tab — the channel-scoped File Explorer (`/projects/[projectId]/[channelId]/files`): the
 * attachments shared in this one channel. Resolves the first file page server-side (the fat
 * {@link ProjectBackendService.files}, no HTTP hop) and hands it to the {@link FileExplorer} island as
 * serializable props; the island refines (sort/filter/search/scroll-load) via the thin `FilesService`.
 * The channel header (with the active Files tab) and the footer View Control Rig are mounted by the
 * shell — this route renders only the workspace body.
 */
export default define.page(function ChannelFilesPage(ctx) {
	const { projectId, channelId } = ctx.params;
	const { page } = resolveFilePage(projectId, channelId);
	return <FileExplorer scope="channel" projectId={projectId} channelId={channelId} initial={page} />;
});
