/**
 * `useDismiss` — close an open overlay (menu/popover/dialog) on outside pointerdown or Escape.
 *
 * Client-only; listeners attach in an effect and tear down on close/unmount. Anchored overlays pass
 * both refs so a click on the trigger itself doesn't double-toggle. Escape is captured so it wins
 * over inner handlers that stop propagation.
 *
 * **"Outside" is ownership, not ancestry.** Every anchored panel in this package is projected into
 * `document.body` by `BodyPortal`, so a dropdown opened from inside a modal is that modal's DOM
 * SIBLING. Testing `panelRef.current.contains(target)` therefore reports a click on the overlay's own
 * child menu as an outside click — which closed the parent modal and, where the modal kept its
 * working copy in a frame cache, discarded the edit in progress. Containment is delegated to
 * {@link isWithinOverlay}, which counts this overlay's panel, its trigger, and the panel of anything
 * transitively opened FROM it. Every open overlay registers for the whole time it is open, not only
 * while it owns dismissal, because a child is by definition never the parent's `isTop`.
 */
import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";
import { isWithinOverlay, registerOverlay } from "./overlay-registry.ts";
import { useId } from "./useId.ts";

export interface DismissOptions {
	open: boolean;
	onDismiss: () => void;
	/** The overlay/panel element — clicks inside are ignored. */
	panelRef: RefObject<HTMLElement>;
	/** The trigger element — clicks here are ignored (its own handler toggles). */
	triggerRef?: RefObject<HTMLElement>;
	/** Close on Escape (default true). */
	closeOnEscape?: boolean;
	/** Close on outside pointer (default true). */
	closeOnOutside?: boolean;
	/**
	 * Whether this overlay currently owns the ESCAPE key — pass `useOverlayStack().isTop` (default true).
	 *
	 * This must gate the listener itself, not just the callback. Every instance registers on `document`
	 * in the capture phase, so listeners run in registration order: an outer dialog that merely no-ops
	 * inside its own callback would still consume the Escape press and starve the inner overlay.
	 *
	 * It does NOT gate outside-pointer dismissal, which is governed by containment instead — see the
	 * comment on the two effects.
	 */
	enabled?: boolean;
}

export function useDismiss(opts: DismissOptions): void {
	const {
		open,
		onDismiss,
		panelRef,
		triggerRef,
		closeOnEscape = true,
		closeOnOutside = true,
		enabled = true,
	} = opts;

	const id = useId(undefined, "overlay");

	// Registration is separate from the listener effect on purpose: an overlay must be visible to the
	// containment model whenever it is OPEN, not only when it happens to own dismissal. A dropdown
	// inside a modal is never `isTop` from the modal's point of view, and if it were unregistered the
	// modal would go straight back to reading its own child's click as an outside click.
	useEffect(() => {
		if (!open || typeof document === "undefined") return;
		return registerOverlay(id, {
			panel: () => panelRef.current ?? null,
			trigger: () => triggerRef?.current ?? null,
		});
	}, [open, id, panelRef, triggerRef]);

	/*
	 * The two channels are gated DIFFERENTLY, because they fail in opposite directions.
	 *
	 * ESCAPE is exclusive: the handler calls `stopImmediatePropagation()`, so exactly one overlay may
	 * own the key or a single press collapses the whole stack. `enabled` (the caller's `isTop`) picks
	 * that owner, and it must gate the LISTENER — an overlay that merely no-ops inside its callback
	 * still consumes the press and starves the overlay above it.
	 *
	 * OUTSIDE POINTER is not exclusive, and gating it on `isTop` made an overlay undismissable for as
	 * long as anything sat above it: with a child dropdown open, its parent stopped listening, so a
	 * click on the page closed only the dropdown and left the parent stranded. Containment already
	 * answers this correctly — a click inside a descendant overlay is inside THIS one, and a click
	 * genuinely outside is outside every overlay in the chain, which should close all of them at once.
	 * So the pointer channel stays live whenever the overlay is open and asks for it.
	 */
	useEffect(() => {
		if (!open || !closeOnOutside || typeof document === "undefined") return;

		const onPointer = (e: PointerEvent) => {
			// `isWithinOverlay` — not `panelRef.contains()` — because every anchored panel in this
			// package is portalled to `document.body`. A child dropdown's option row is a DOM sibling of
			// this overlay, so ancestry alone reports a click on our own menu as an outside click.
			if (isWithinOverlay(e.target as Node | null, id)) return;
			onDismiss();
		};

		document.addEventListener("pointerdown", onPointer, true);
		return () => document.removeEventListener("pointerdown", onPointer, true);
	}, [open, id, onDismiss, closeOnOutside]);

	useEffect(() => {
		if (!open || !enabled || !closeOnEscape || typeof document === "undefined") return;

		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// `stopImmediatePropagation`, not `stopPropagation`: sibling listeners on `document` itself
			// are unaffected by the latter, so one press used to close the whole stack at once.
			e.stopImmediatePropagation();
			e.preventDefault();
			onDismiss();
		};

		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [open, enabled, onDismiss, closeOnEscape]);
}
