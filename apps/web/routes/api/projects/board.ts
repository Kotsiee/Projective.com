import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { BoardPage, BoardView, TicketPriority } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/board` — the thin route for the Kanban board read. HTTP parse +
 * light param guard, then delegate to the fat {@link ProjectBackendService.board} and map its
 * {@link ServiceResult} to the client body via {@link toProjectsBody}. `channelId` selects the
 * stage-level Tasks board; `view` selects the project board's Stages/Statuses grouping. The Zod SSOT
 * (`BoardListParamsSchema`) is the shape contract; the route whitelists the enum params exactly as the
 * sibling `files`/`submissions` routes do. Islands never reach the backend — they fetch this via the
 * dumb `BoardService`.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-`projectId` guard returns its 400 from inside `resolve` rather
 * than from a hand-written `GET`, so that refusal is stated once and `HEAD` reports the same status
 * with the body stripped by the factory. See that module for the caching and CORS decisions.
 */

const VIEWS: readonly BoardView[] = ["stages", "statuses"];
const PRIORITIES: readonly TicketPriority[] = ["low", "normal", "high", "urgent"];

export const handler = define.handlers(
	defineReadRoute<{ page: BoardPage }>({
		resolve: (ctx) => {
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

			return ProjectBackendService.board({
				projectId,
				channelId: channelId || null,
				view,
				query: sp.get("query") || undefined,
				assignee: sp.get("assignee") || undefined,
				priority,
			}, readActor(ctx));
		},
		toBody: toProjectsBody,
	}),
);
