import { getProjects, postProjects } from "./api.ts";
import type {
	BoardCard,
	BoardListParams,
	BoardPage,
	CommitTicket,
	MoveTicket,
} from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * BoardService — the dumb client service for the Kanban board. It builds the query string or the JSON
 * body and calls the transport helpers, returning a soft {@link ProjectsResult}; it never throws, so
 * the board island stays dumb (mirrors {@link FilesService}). The board loads its full card set once per
 * scope + grouping; search/priority/assignee filtering is applied client-side. A grouping switch
 * (Stages ⁄ Statuses) is the one refine that re-`list`s (different columns).
 *
 * Both writes answer with the card as the SERVER sees it, and that is the point of them: the board
 * moves optimistically, so the returned card is what the optimistic row is replaced BY — never merely
 * a signal that the optimistic row was right.
 */
export const BoardService = {
	list(params: BoardListParams): Promise<ProjectsResult<{ page: BoardPage }>> {
		const qs = new URLSearchParams({ projectId: params.projectId });
		if (params.channelId) qs.set("channelId", params.channelId);
		if (params.view) qs.set("view", params.view);
		if (params.query) qs.set("query", params.query);
		if (params.assignee) qs.set("assignee", params.assignee);
		if (params.priority) qs.set("priority", params.priority);
		return getProjects<{ page: BoardPage }>(`/api/projects/board?${qs.toString()}`);
	},

	/**
	 * Create or replace one ticket.
	 *
	 * The payload carries the client's optimistic `clientId` so the answer can be matched back to the
	 * row already on the board; the returned card carries the real server id, which is the only id
	 * anything may address the ticket by afterwards.
	 */
	commit(payload: CommitTicket): Promise<ProjectsResult<{ card: BoardCard }>> {
		return postProjects<{ card: BoardCard }>("/api/projects/board/ticket", payload);
	},

	/**
	 * Persist a board drag.
	 *
	 * The RESOLVED destination is sent — the target status and the stage it lands in — never a column
	 * id: which lane a card is drawn in is a rendering decision, and the server must not have to
	 * reverse-engineer a lifecycle transition out of one.
	 */
	move(payload: MoveTicket): Promise<ProjectsResult<{ card: BoardCard }>> {
		return postProjects<{ card: BoardCard }>("/api/projects/ticket/move", payload);
	},
};
