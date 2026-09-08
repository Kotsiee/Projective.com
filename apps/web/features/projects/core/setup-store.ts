import { signal } from "@preact/signals";
import type { ProjectSetup } from "../types/projects-types.ts";

/**
 * Setup store — the LEAF holding the owner's working copy, and nothing else.
 *
 * These three signals are declared here rather than in `core/setup-state.ts` because they have two
 * kinds of reader. The setup surface itself (header band · body form · footer rig) wants the whole
 * state machine — the save serialiser, the offline queue, the toast channel, the thin service — and
 * imports `setup-state.ts` for it. The middle-nav LANE wants only the values, on every
 * `/projects/{slug}/…` route there is, including the ones that edit nothing: a chat, a board, a file
 * grid. Importing the machine to read a title would pull the queue, the network watcher and the
 * client service into the bundle of every one of them.
 *
 * `setup-state.ts` re-exports `setupDraft` and `setupBaseline`, so nothing that already reads them
 * has to learn about this module.
 *
 * @module
 */

// #region The working copy
/** The live, possibly-unsaved configuration. `null` until the body island seeds it on mount. */
export const setupDraft = signal<ProjectSetup | null>(null);

/** The last configuration the SERVER acknowledged — the only honest measure of "unchanged". */
export const setupBaseline = signal<ProjectSetup | null>(null);
// #endregion

// #region The commit signal
/**
 * How many writes this surface has had ACKNOWLEDGED, monotonically.
 *
 * The lane re-reads the engagement when this moves and its own projection says the read would
 * change something — which is how a stage that has just been created acquires the channel the
 * sidebar needs before it can offer a link to it.
 *
 * A counter rather than a boolean or the setup itself, and each of those alternatives fails
 * differently: a boolean cannot distinguish two consecutive saves, and publishing the acknowledged
 * `ProjectSetup` would invite the lane to render the SERVER's copy — which is a render behind
 * whatever the owner has typed since, and would flicker the sidebar back one edit on every
 * auto-save. The counter says only *that* something landed; the draft stays the single source of
 * what to draw.
 */
export const setupCommitEpoch = signal<number>(0);

/** Record that a write was acknowledged by the server. */
export function markSetupCommitted(): void {
	setupCommitEpoch.value = setupCommitEpoch.value + 1;
}
// #endregion
