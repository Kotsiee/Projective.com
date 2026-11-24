import { type ProjectSetup, reconcileSetup } from "../types/projects-types.ts";
import { ProjectSidebarService } from "./ProjectSidebarService.ts";
import { settleSaves } from "./setup-persistence.ts";
import { onboardingSim, patchSetup, reportError } from "./setup-signals.ts";
import { markSetupCommitted, setupBaseline, setupDraft } from "./setup-store.ts";
import { isOnline } from "@web/utils/network.ts";

/**
 * Setup stage removal — what the stage list's Remove does (PROJECTS ST2, Decision #553). A PATCH never
 * removes a stage (the reconcile keeps every stored stage it omits), so a saved stage leaves through
 * its own door, `DELETE /api/projects/:id/stages/:stageId`, before the draft lets go of it.
 *
 * @module
 */

// #region Removal
/**
 * What Remove did to one stage.
 *
 * - `dropped`: it was never saved (no slug), so it left the draft and nothing was sent.
 * - `removed`: it was saved and `removable`, the door deleted it, and it left the draft AND the
 *   baseline: the removal is already saved, so it must not read as an unsaved change, and the next
 *   save omits it legitimately.
 * - `locked`: it has work or money on it, so nothing moved and the caller explains why
 *   (`STAGE_REMOVAL_LOCKED_MESSAGE`). **PM-WP4b owns this branch:** once a touched stage can be
 *   archived, Remove archives it here instead of refusing.
 * - `failed`: the server could not be reached or refused for another reason, which is reported.
 */
export type StageRemoval = "dropped" | "removed" | "locked" | "failed";

/**
 * Remove one stage of the draft. The flag it reads is the server's (`StageSetup.removable`, from
 * `projects.stage_removability`), never a client rule, and the door re-asks it anyway: a stage that
 * gained a ticket since the read comes back `409 stage_has_history`, which is `locked` too.
 */
export async function removeSetupStage(stageId: string): Promise<StageRemoval> {
	const stage = setupDraft.peek()?.stages.find((s) => s.id === stageId);
	if (!stage) return "failed";
	if (stage.slug === null) {
		dropStage(stageId, false);
		return "dropped";
	}
	if (!stage.removable) return "locked";
	// The removal must not cross a save in flight: that save's payload still names the stage.
	await settleSaves();
	const draft = setupDraft.peek();
	if (!draft) return "failed";
	if (!isOnline.peek()) {
		reportError("Removing a stage needs a connection.");
		return "failed";
	}
	const res = await ProjectSidebarService.deleteStage(draft.slug, stage.slug, onboardingSim());
	if (!res.ok) {
		if (res.errors?.stage === "stage_has_history") return "locked";
		reportError(res.message ?? "That stage was not removed — please try again.");
		return "failed";
	}
	dropStage(stageId, true);
	markSetupCommitted();
	return "removed";
}

/**
 * Drop a stage from the draft, and from the baseline once the server has deleted it. A sibling that
 * waited for it waits for the one above it instead, as `delete_stage` leaves it.
 */
function dropStage(stageId: string, saved: boolean): void {
	const without = (setup: ProjectSetup) => ({
		stages: setup.stages.filter((s) => s.id !== stageId).map((s) =>
			s.startsWithId === stageId ? { ...s, startsWithId: null } : s
		),
	});
	const baseline = setupBaseline.peek();
	if (saved && baseline) setupBaseline.value = reconcileSetup(baseline, without(baseline));
	const draft = setupDraft.peek();
	if (draft) patchSetup(without(draft));
}
// #endregion
