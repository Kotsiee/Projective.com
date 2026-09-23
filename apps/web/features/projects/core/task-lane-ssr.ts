import type { ProjectDetail } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import { resolveBoardPage } from "./board-ssr.ts";
import { buildTaskLane, type TaskLane } from "./task-lane.ts";

/**
 * task-lane-ssr — the server-only bootstrap for a Task engagement's lane. Resolves the project board
 * through the fat service (no HTTP hop, and the same cached read the Tasks board makes) and projects it
 * with {@link buildTaskLane}, so the lane's overview and task lists ship in the first byte.
 *
 * Called by the `(dashboard)` layout ONLY once the detail read has said the engagement is a Task, so a
 * pipeline or a one-off never pays for a board read its lane would not draw. Never imported by an
 * island (it reaches `@server/services`).
 */
export async function resolveTaskLane(detail: ProjectDetail, actor: ReadActor): Promise<TaskLane> {
	const { page } = await resolveBoardPage(detail.slug, actor);
	return buildTaskLane(detail, page);
}
