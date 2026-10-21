import { define } from "@web/utils/state.ts";
import { resolveFileExplorer } from "@web/features/projects/core/files-ssr.ts";
import { FilesView } from "@web/features/projects/components/workspace-views.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Files tab — the channel-scoped File Explorer (`/projects/[projectId]/[channelId]/files`): the
 * attachments shared in this one channel. Resolves the first file page server-side (the fat
 * {@link ProjectBackendService.files}, no HTTP hop) beside the project's channel index, so the shared
 * frame's left panel draws the project's file tree with this channel selected and every other node a
 * link to its own address (Decision #317). The island refines (sort/filter/search/scroll-load) via the
 * thin `FilesService`. The channel header owns the middle-nav band, so the toolbar sits above the grid;
 * the footer View Control Rig is mounted by the shell — this route renders only the workspace body.
 */
export default define.page(async function ChannelFilesPage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId, channelId } = ctx.params;
	const boot = await resolveFileExplorer(ctx.url, projectId, actor, channelId);
	return (
		<FilesView
			scope="channel"
			id={projectId}
			channelId={channelId}
			initial={boot.page}
			tree={{ selection: boot.selection, routes: boot.routes, index: boot.index }}
		/>
	);
});
