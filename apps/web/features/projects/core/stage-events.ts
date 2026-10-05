import { signal } from "@preact/signals";

// #region Stage-created broadcast
/**
 * How many stages this page has created — bumped by {@link BoardService.createStage} on every
 * persisted create, whichever island issued it.
 *
 * The Board and the Timeline create stages, but the lane's channel tree is a different hydration root
 * that only knows a stage once its room has been read back. A module signal is the shared channel the
 * two islands already use for every other footer ⇄ body intent (`board-state.ts`); the lane watches
 * this number and re-reads the engagement, so a new stage's room appears without a reload.
 */
export const stagesCreatedEpoch = signal<number>(0);

/** Announce a persisted stage. Called by the service, never by an island directly. */
export function announceStageCreated(): void {
	stagesCreatedEpoch.value = stagesCreatedEpoch.peek() + 1;
}
// #endregion
