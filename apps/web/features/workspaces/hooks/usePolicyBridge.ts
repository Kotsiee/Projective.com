import { type ReadonlySignal, untracked, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import {
	discardRequested,
	policyDirty,
	saveRequested,
	saveState,
} from "../core/workspace-state.ts";

/** A policy editor as the footer rig sees it. */
export interface PolicyEditor {
	/** Whether the editor holds unsaved changes. */
	dirty: ReadonlySignal<boolean>;
	/** Persist the changes — answers the rig's Save. */
	save: () => void | Promise<void>;
	/** Return every field to its last saved value — answers the rig's Discard. */
	discard: () => void;
}

/**
 * usePolicyBridge — the ONE contract between a policy editor (Payouts, Spend, Billing) and the footer
 * rig's Save and Discard, which live in a different hydration root and cannot be handed a callback.
 *
 *   - **Dirty out.** The editor's `dirty` is mirrored into `policyDirty`, so the rig draws Save (tier 3)
 *     and Discard (tier 5) only while there is something to save; it falls back to `false` when the
 *     editor unmounts, so a stale flag never greets the next module.
 *   - **Pulses in.** `saveRequested` / `discardRequested` are counters; each change is one press. A
 *     pulse already on the counter when the editor mounts is not a press for this editor and is
 *     ignored. The handler runs untracked, so the signals it reads do not re-arm the effect.
 *
 * Signal-driven throughout (`useSignalEffect`), never a `useEffect` keyed on a signal's value.
 */
export function usePolicyBridge(editor: PolicyEditor): void {
	useSignalEffect(() => {
		policyDirty.value = editor.dirty.value;
		return () => {
			policyDirty.value = false;
		};
	});

	const seen = useRef({ save: saveRequested.peek(), discard: discardRequested.peek() });

	useSignalEffect(() => {
		const pulse = saveRequested.value;
		if (pulse === seen.current.save) return;
		seen.current.save = pulse;
		untracked(() => void editor.save());
	});

	useSignalEffect(() => {
		const pulse = discardRequested.value;
		if (pulse === seen.current.discard) return;
		seen.current.discard = pulse;
		untracked(() => {
			editor.discard();
			saveState.value = "idle";
		});
	});
}
