import { define } from "@web/utils/state.ts";
import { resolveFileExplorer } from "@web/features/projects/core/files-ssr.ts";
import { FilesView } from "@web/features/projects/components/workspace-views.tsx";
import { readActor } from "@web/utils/api-session.ts";

/**
 * Project-scoped File Explorer (`/projects/[projectId]/files[?in=project|<channel>]`) — every
 * attachment across the project's channels, with the {@link FileChannelTree} navigator (All files ·
 * Project files · the channels) in the shared frame's left panel. The node in view rides in `?in=`
 * (Decision #317), so it is resolved server-side with the page — and with the whole channel index,
 * which a narrowed read would otherwise collapse to one room. This is a project-view path (not a
 * channel), so no channel header claims the middle-nav band: it carries the node's title and the
 * explorer's toolbar (`explorerHeaderFor`), reading the same request-memoized bootstrap.
 */
export default define.page(async function ProjectFilesPage(ctx) {
	const actor = readActor(ctx);
	const { projectSlug: projectId } = ctx.params;
	const boot = await resolveFileExplorer(ctx.url, projectId, actor);
	return (
		<FilesView
			scope="project"
			id={projectId}
			initial={boot.page}
			tree={{ selection: boot.selection, routes: boot.routes, index: boot.index }}
		/>
	);
});
