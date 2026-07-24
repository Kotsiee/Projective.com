import { define } from "@web/utils/state.ts";
import { resolveFilePage } from "@web/features/projects/core/files-ssr.ts";
import { FilesView } from "@web/features/projects/components/workspace-views.tsx";

/**
 * Project-scoped File Explorer (`/projects/[projectId]/files`) — every attachment across the project's
 * channels, with the {@link FileChannelTree} navigator prepending Channels as the top level of the
 * tree. Resolves the first (all-channels) file page server-side (the fat
 * {@link ProjectBackendService.files}, no HTTP hop, `channelId` omitted → project scope) and hands it
 * to the {@link FileExplorer} island. This is a project-view path (not a channel), so the shell mounts
 * no channel header — only the Project Details lane + the footer View Control Rig.
 */
export default define.page(function ProjectFilesPage(ctx) {
	const { projectId } = ctx.params;
	const { page } = resolveFilePage(projectId);
	return <FilesView scope="project" id={projectId} initial={page} />;
});
