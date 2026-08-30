import { define } from "@web/utils/state.ts";
import { resolveBoardPage } from "@web/features/projects/core/board-ssr.ts";
import ProjectBoard from "@web/features/projects/islands/ProjectBoard.island.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Tasks — the stage-level Kanban board (`/projects/[projectId]/[channelId]/tasks`): columns are the
 * ticket STATUS lanes (New · Ready · In Progress · Review · Completed) for this one stage's tickets;
 * the client creates tickets in the New column only. Resolves the stage board server-side (the fat
 * {@link ProjectBackendService.board} scoped by `channelId`) and hands it to the {@link ProjectBoard}
 * island. The channel header (active Tasks tab) + the footer action rig are mounted by the shell.
 */
export default define.page(async function ChannelTasksPage(ctx) {
	const actor = readActor(ctx);
	const { projectId, channelId } = ctx.params;
	const { page } = await resolveBoardPage(projectId, actor, channelId);
	return (
		<ProjectBoard scope="channel" projectId={projectId} channelId={channelId} initial={page} />
	);
});
