import type { ModalStack } from "@ui/overlay/core/modal-stack.ts";
import type { AssetItem } from "../types/file-types.ts";

/**
 * picker-frame — the Asset Picker as a frame of a modal stack. Opened from inside a modal, the picker
 * REPLACES that modal on its stack rather than covering it, so the frame that asked for files is
 * unmounted when the answer arrives. The answer is handed off through that frame's own cache entry,
 * which it takes once when it is restored, and which dies with the frame if the chain closes first.
 *
 * Pure and DOM-free: the stack is the only state it touches.
 */

// #region Frame
/** The modal-stack frame a framed picker renders as. */
export interface PickerFrameRef {
	stack: ModalStack<string, unknown>;
	uid: number;
}
// #endregion

// #region Handoff
/** The frame-cache key the requesting frame receives its picks under. */
export const PICKER_HANDOFF_KEY = "picker:handoff";

/** Append picks for a frame that is not mounted, de-duplicated by id. */
export function handOffPicks(
	stack: ModalStack<string, unknown>,
	uid: number,
	assets: readonly AssetItem[],
): void {
	if (assets.length === 0) return;
	const held = stack.read<AssetItem[]>(uid, PICKER_HANDOFF_KEY, []);
	const seen = new Set(held.map((a) => a.id));
	const next = [...held];
	for (const asset of assets) {
		if (seen.has(asset.id)) continue;
		seen.add(asset.id);
		next.push(asset);
	}
	stack.write(uid, PICKER_HANDOFF_KEY, next);
}

/** Read and clear the picks handed off to a frame; `[]` when there are none. */
export function takePicks(stack: ModalStack<string, unknown>, uid: number): AssetItem[] {
	const held = stack.read<AssetItem[]>(uid, PICKER_HANDOFF_KEY, []);
	if (held.length > 0) stack.write(uid, PICKER_HANDOFF_KEY, []);
	return held;
}
// #endregion
