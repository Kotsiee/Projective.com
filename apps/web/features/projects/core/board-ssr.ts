import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { BoardPage, BoardView } from "../types/projects-types.ts";

/**
 * board-ssr — the server-only bootstrap for the Kanban board's first paint. Calls the fat
 * {@link ProjectBackendService.board} directly (no HTTP hop) so the board ships its columns + cards in
 * the initial byte; the island then refines (search/filter, Stages⁄Status switch) via the thin
 * {@link BoardService}. Mirrors {@link resolveFilePage}. Never imported by an island. `channelId` set →
 * the stage-level Tasks board.
 */
export interface BoardBootstrap {
	page: BoardPage | null;
}

/** Resolve the initial board page. `channelId` set → the stage-level Tasks board. */
export function resolveBoardPage(
	projectId: string,
	channelId?: string | null,
	view?: BoardView,
): BoardBootstrap {
	const res = ProjectBackendService.board({ projectId, channelId: channelId ?? null, view });
	return { page: res.ok && res.data ? res.data.page : null };
}
