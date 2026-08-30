import { define } from "@web/utils/state.ts";
import { resolveBoardPage } from "@web/features/projects/core/board-ssr.ts";
import ProjectBoard from "@web/features/projects/islands/ProjectBoard.island.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Board — the project-level Kanban pipeline (`/projects/[projectId]/board`): columns are `New` + each
 * Stage + `Completed`, and a ticket flows through them. Resolves the board server-side (the fat
 * {@link ProjectBackendService.board}, no HTTP hop — it also carries `viewerIsClient`, which gates the
 * client-only ticket moves + Create actions) and hands it to the {@link ProjectBoard} island. The lane
 * (Project Details sidebar) and the footer action rig are mounted by the shell; this route renders only
 * the board body.
 */
export default define.page(async function ProjectBoardPage(ctx) {
	const actor = readActor(ctx);
	const { projectId } = ctx.params;
	const { page } = await resolveBoardPage(projectId, actor);
	return <ProjectBoard scope="project" projectId={projectId} initial={page} />;
});
