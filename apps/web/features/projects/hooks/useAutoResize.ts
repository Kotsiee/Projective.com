import { useRef } from "preact/hooks";
import type { RefObject } from "preact";
import { TEXTAREA_MAX_H } from "../core/composer-model.ts";

/**
 * useAutoResize — grow a `<textarea>` to fit its content up to `maxHeight`, then let it scroll. The
 * measurement (`scrollHeight`) is inherently imperative DOM, so this is the sanctioned `useRef`
 * escape hatch (root CLAUDE.md §Signal-first: `useRef` is fine for external/non-reactive DOM), not a
 * styling inline-style — it writes only the dynamic pixel height, never design values.
 */
export interface AutoResize {
	ref: RefObject<HTMLTextAreaElement>;
	/** Recompute the height (call on input, and after clearing/seeding the value). */
	resize: () => void;
}

export function useAutoResize(maxHeight: number = TEXTAREA_MAX_H): AutoResize {
	const ref = useRef<HTMLTextAreaElement>(null);

	function resize(): void {
		const el = ref.current;
		if (!el) return;
		// Collapse first so shrink-on-delete is measured, then clamp to the ceiling.
		el.style.height = "auto";
		const next = Math.min(el.scrollHeight, maxHeight);
		el.style.height = `${next}px`;
		el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
	}

	return { ref, resize };
}
