import { useEffect } from "preact/hooks";
import { autoSaveOnBlur, hydrateAutoSave } from "../core/setup-state.ts";

/**
 * useSetupAutoSave — the blur→persist wiring shared by every body that edits a {@link ProjectSetup}.
 *
 * Two surfaces edit the same draft through the same store: the whole-project form on
 * `/projects/[projectId]` and the single-stage form on
 * `/projects/[projectId]/[channelId]/details`. The listener and its settle delay are a timing rule
 * rather than a layout choice, so they live here once instead of once per island — a delay tuned on
 * one surface and not the other would make auto-save behave differently depending on which route the
 * owner happened to be editing from, with nothing on screen to explain the difference.
 *
 * The decision itself is NOT here. {@link autoSaveOnBlur} re-reads the preference, the dirty flag and
 * the draft's own blockers when the timer fires, so this hook only decides WHEN to ask.
 */

// #region Timing
/**
 * How long a field is left alone before an auto-save is considered.
 *
 * Long enough for the blurring field's own commit to land and for a fast tab-through to collapse
 * into one save; short enough that the edit is on the server before the owner has finished reaching
 * for whatever they were going to do next.
 */
const AUTO_SAVE_SETTLE_MS = 250;
// #endregion

/**
 * Persist the draft shortly after a field loses focus, if the owner has asked for that.
 *
 * Watches `focusout`, not `blur`. `blur` does not bubble, so catching it for every field would mean
 * binding a listener per control — including controls that do not exist yet, since a stage, a step
 * or a role can be added at any moment. `focusout` is the bubbling counterpart and covers the whole
 * form from one place, by construction.
 *
 * The settle delay does two jobs, and the first is correctness rather than throttling: a field that
 * commits its own draft on blur (every numeric field here does) has to be allowed to land before the
 * dirty check runs, and the relative order of `blur` and `focusout` is not something to depend on.
 * The second is that it collapses a fast tab-through into one save instead of one per field.
 */
export function useSetupAutoSave(): void {
	/*
	 * The consumer of the preference is also what adopts it, so the two cannot come apart.
	 *
	 * The preference is a device fact in `localStorage` and only the footer rig used to read it in —
	 * which was fine while the rig was the only surface, and becomes a silent failure the moment a
	 * second body edits the same draft: auto-save would sit at its `false` default there, so an owner
	 * who had turned it ON would watch it not happen, with nothing anywhere saying why. The rig still
	 * calls `hydrateAutoSave` for itself because it RENDERS the switch and must not depend on a body
	 * having mounted; both are idempotent reads of one key.
	 *
	 * In an effect, not at render: `localStorage` does not exist on the server, and a device with it
	 * disabled would otherwise paint one state and hydrate to another.
	 */
	useEffect(hydrateAutoSave, []);

	useEffect(() => {
		let settle: ReturnType<typeof setTimeout> | undefined;
		const onFocusOut = () => {
			clearTimeout(settle);
			settle = setTimeout(autoSaveOnBlur, AUTO_SAVE_SETTLE_MS);
		};
		globalThis.addEventListener("focusout", onFocusOut);
		return () => {
			clearTimeout(settle);
			globalThis.removeEventListener("focusout", onFocusOut);
		};
	}, []);
}
