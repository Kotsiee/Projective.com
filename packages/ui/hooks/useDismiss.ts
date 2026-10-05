/**
 * `useDismiss` — close an open overlay (menu/popover/dialog) on outside pointerdown or Escape.
 *
 * Client-only; listeners attach in an effect and tear down on close/unmount. Anchored overlays pass
 * both refs so a click on the trigger itself doesn't double-toggle. Escape is owned by one
 * {@link pushEscapeLayer} stack, so only the most recently opened overlay ever receives it.
 *
 * **"Outside" is ownership, not ancestry.** Every anchored panel in this package is projected into
 * `document.body` by `BodyPortal`, so a dropdown opened from inside a modal is that modal's DOM
 * SIBLING. Testing `panelRef.current.contains(target)` therefore reports a click on the overlay's own
 * child menu as an outside click — which closed the parent modal and, where the modal kept its
 * working copy in a frame cache, discarded the edit in progress. Containment is delegated to
 * {@link isWithinOverlay}, which counts this overlay's panel, its trigger, and the whole layer —
 * backdrop included — of anything transitively opened FROM it. Every open overlay registers for the
 * whole time it is open, not only while it owns dismissal, because a child is by definition never
 * the parent's `isTop`.
 *
 * A nested overlay is linked to its opener by its trigger, else by {@link DismissOptions.hostRef},
 * else by the overlay that was open when it registered. Passing neither ref is supported and is what
 * most modals do; passing a host is strictly better where one exists.
 */
import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import { pushEscapeLayer } from "./escape-stack.ts";
import { isWithinOverlay, registerOverlay } from "./overlay-registry.ts";
import { useId } from "./useId.ts";

export interface DismissOptions {
	open: boolean;
	onDismiss: () => void;
	/** The overlay/panel element — clicks inside are ignored. */
	panelRef: RefObject<HTMLElement>;
	/** The trigger element — clicks here are ignored (its own handler toggles). */
	triggerRef?: RefObject<HTMLElement>;
	/**
	 * An element this overlay renders IN PLACE — not portalled — for a surface opened from state
	 * rather than from one particular control.
	 *
	 * A modal usually has no `triggerRef`: it is opened by a signal, often from a menu item that
	 * unmounts as the modal appears, so there is no live element tying it to its opener. Ownership
	 * then falls back to open order, which is right in practice but weaker than the DOM. A host node
	 * makes the link exact again — the asset picker renders one inside the tab that mounted it, so it
	 * is provably the ticket modal's child however many other overlays opened in between.
	 */
	hostRef?: RefObject<HTMLElement>;
	/** Close on Escape (default true). */
	closeOnEscape?: boolean;
	/** Close on outside pointer (default true). */
	closeOnOutside?: boolean;
	/**
	 * Whether this overlay currently owns the ESCAPE key — pass `useOverlayStack().isTop` (default true).
	 *
	 * Escape already reaches only the most recently opened overlay; this further silences it while a
	 * non-dismissing surface (e.g. a full-screen `BlockUI`) sits above. It does NOT gate
	 * outside-pointer dismissal, which is governed by containment instead.
	 */
	enabled?: boolean;
}

export function useDismiss(opts: DismissOptions): void {
	const {
		open,
		onDismiss,
		panelRef,
		triggerRef,
		hostRef,
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
			host: () => hostRef?.current ?? null,
		});
	}, [open, id, panelRef, triggerRef, hostRef]);

	/*
	 * The two channels are gated DIFFERENTLY, because they fail in opposite directions.
	 *
	 * ESCAPE is exclusive: one `escape-stack` listener hands each press to the top layer only, so a
	 * single press can never collapse the stack, whatever order the overlays rendered in.
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

	const live = useRef({ onDismiss, enabled, closeOnEscape });
	live.current = { onDismiss, enabled, closeOnEscape };

	useEffect(() => {
		if (!open || typeof document === "undefined") return;
		return pushEscapeLayer({
			enabled: () => live.current.enabled,
			closeOnEscape: () => live.current.closeOnEscape,
			dismiss: () => live.current.onDismiss(),
		});
	}, [open]);
}
