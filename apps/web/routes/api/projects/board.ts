import { define } from "@web/utils/state.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { BoardView, TicketPriority } from "@projective/types/projects";

/**
 * `/api/projects/board` — the thin route for the Kanban board read. HTTP parse + light param guard,
 * then delegate to the fat {@link ProjectBackendService.board} and map its {@link ServiceResult} to a
 * `Response` via {@link toProjectsResponse}. `channelId` selects the stage-level Tasks board; `view`
 * selects the project board's Stages/Statuses grouping. The Zod SSOT (`BoardListParamsSchema`) is the
 * shape contract; the route whitelists the enum params exactly as the sibling `files`/`submissions`
 * routes do. Islands never reach the backend — they fetch this via the dumb `BoardService`.
 */

const VIEWS: readonly BoardView[] = ["stages", "statuses"];
const PRIORITIES: readonly TicketPriority[] = ["low", "normal", "high", "urgent"];

export const handler = define.handlers({
	GET(ctx) {
		const projectId = ctx.url.searchParams.get("projectId");
		if (!projectId) {
			return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
		}

		const sp = ctx.url.searchParams;
		const channelId = sp.get("channelId");
		const viewRaw = sp.get("view");
		const priorityRaw = sp.get("priority");

		const view = viewRaw && VIEWS.includes(viewRaw as BoardView)
			? (viewRaw as BoardView)
			: undefined;
		const priority = priorityRaw && PRIORITIES.includes(priorityRaw as TicketPriority)
			? (priorityRaw as TicketPriority)
			: undefined;

		return toProjectsResponse(
			ProjectBackendService.board({
				projectId,
				channelId: channelId || null,
				view,
				query: sp.get("query") || undefined,
				assignee: sp.get("assignee") || undefined,
				priority,
				tag: sp.get("tag") || undefined,
			}),
		);
	},
});
