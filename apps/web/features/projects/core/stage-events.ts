import { signal } from "@preact/signals";
import type { BoardStageRef } from "../types/projects-types.ts";

// #region Stage-created broadcast
/**
 * How many stages this page has created — bumped by {@link BoardService.createStage} on every
 * persisted create, whichever island issued it.
 *
 * The Board, the Timeline, their footer rigs and the lane all create stages, and each is a different
 * hydration root. A module signal is the shared channel the islands already use for every other footer
 * ⇄ body intent (`board-state.ts`); the lane watches this number and re-reads the engagement, so a new
 * stage's room appears without a reload.
 */
export const stagesCreatedEpoch = signal<number>(0);

/** The last stage this page created, and the project (route slug) it belongs to. */
export interface CreatedStageEvent {
	projectId: string;
	stage: BoardStageRef;
}

/**
 * The last persisted stage, as the server projected it. The Board and the Timeline splice it into the
 * stages they draw, so a stage created from the lane or a footer rig becomes a column at once.
 */
export const lastCreatedStage = signal<CreatedStageEvent | null>(null);

/** Announce a persisted stage. Called by the service, never by an island directly. */
export function announceStageCreated(projectId: string, stage: BoardStageRef): void {
	lastCreatedStage.value = { projectId, stage };
	stagesCreatedEpoch.value = stagesCreatedEpoch.peek() + 1;
}

/**
 * `stages` with a created stage in place — added, or replacing the row with its id — in stage order.
 * Pure and idempotent, so a host that hears the same announcement twice draws one column.
 */
export function withCreatedStage(
	stages: readonly BoardStageRef[],
	created: BoardStageRef,
): BoardStageRef[] {
	return [...stages.filter((s) => s.id !== created.id), created].sort((a, b) => a.order - b.order);
}
// #endregion
