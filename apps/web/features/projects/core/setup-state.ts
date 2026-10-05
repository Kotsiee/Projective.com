/**
 * Setup view-state — the one import for the owner's Details surface on `/projects/[projectId]`.
 *
 * A barrel over the three modules the store is built from:
 *
 * - `setup-signals.ts` — the working copy and its UI state (`setupDraft`, `setupBaseline`,
 *   `setupSaving`, `setupSavedAt`, `setupQueued`, `setupReveal`, `setupDirty`), the outcome toast
 *   channel, seeding and local edits (`seedSetup`, `patchSetup`, `discardSetup`, `resetSetupState`),
 *   the offline restore and the onboarding simulation (`refreshSetup`, `watchOnboardingSim`).
 * - `setup-persistence.ts` — every write: the payload, the save serialiser (`requestSave`,
 *   `settleSaves`), auto-save on blur, `publishSetup`, `archiveSetup` and the offline flush.
 * - `setup-validation.ts` — the blur-gated field verdicts and `firstBlocker`, the reason a save
 *   cannot proceed.
 *
 * The dependency runs one way — persistence imports signals, never the reverse — so the toast channel
 * and the store initialise once, in one module, whichever island loads first. Islands keep importing
 * from here; reaching into a member module directly is for code inside this feature's `core/`.
 */

// #region Working copy + local edits
export {
	currentSetup,
	discardSetup,
	patchSetup,
	refreshSetup,
	resetSetupState,
	seedSetup,
	setupBaseline,
	setupDirty,
	setupDraft,
	setupQueued,
	setupReveal,
	setupSavedAt,
	setupSaving,
	watchOnboardingSim,
} from "./setup-signals.ts";
// #endregion

// #region Persistence
export {
	archiveSetup,
	autoSaveEnabled,
	autoSaveOnBlur,
	flushQueuedWrites,
	hydrateAutoSave,
	publishSetup,
	requestSave,
	type SaveTrigger,
	setAutoSave,
	settleSaves,
	watchOfflineFlush,
} from "./setup-persistence.ts";

/**
 * Re-exported so the two footer bands have ONE import for the whole save story.
 *
 * They already read six signals from this module to decide what to render; reaching past it into
 * `utils/network.ts` for the seventh would make the connection look like a separate concern from
 * whether the draft is saved, when on this surface it is the same question.
 */
export { isOnline } from "@web/utils/network.ts";
// #endregion
