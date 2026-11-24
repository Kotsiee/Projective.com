import { define } from "@web/utils/state.ts";
import { resolveFileExplorer } from "@web/features/projects/core/files-ssr.ts";
import { FilesView } from "@web/features/projects/components/workspace-views.tsx";
import { readActor } from "@web/utils/api-session.ts";
import { isSlug } from "@projective/types/slugs";
import { resolveConversationFiles } from "@web/features/messaging/core/conversations-ssr.ts";
import { ConversationNotFound } from "@web/features/messaging/components/ConversationNotFound.tsx";

/**
 * Files tab — the channel-scoped File Explorer (`/projects/[projectId]/[channelId]/files`): the
 * attachments shared in this one channel. Resolves the first file page server-side (the fat
 * {@link ProjectBackendService.files}, no HTTP hop) beside the project's channel index, so the shared
 * frame's left panel draws the project's file tree with this channel selected and every other node a
 * link to its own address (Decision #317). The island refines (sort/filter/search/scroll-load) via the
 * thin `FilesService`. The channel header owns the middle-nav band, so the toolbar sits above the grid;
 * the footer View Control Rig is mounted by the shell — this route renders only the workspace body.
 *
 * A `cht-` segment is a thread seen through the project (Decision #339 ruling N1), which the
 * `[channelId]` middleware has already confirmed is one of the project's Private Messages. Its files
 * are the thread's, so it renders the reader `/messages/cht-…/files` renders (the fat
 * {@link MessagingBackendService.files}, the `conversation` scope), not the project's file tree
 * (PROJECTS CH3; Decision #508 (c)).
 */
export default define.page(async function ChannelFilesPage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId, channelId } = ctx.params;
	if (isSlug(channelId, "thread")) {
		const initial = await resolveConversationFiles(channelId, actor);
		if (!initial) return <ConversationNotFound />;
		return (
			<FilesView scope="conversation" id={channelId} channelId={channelId} initial={initial} />
		);
	}
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
