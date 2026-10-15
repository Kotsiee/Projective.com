import type { RefObject } from "preact";

// #region Types
/** The card or list item a menu binds its right-click to: a ref, or a getter resolved at bind time. */
export type ContextSurfaceSource = RefObject<HTMLElement> | (() => HTMLElement | null);

/** What a `contextmenu` event carries that decides whether the custom menu takes it. */
export interface ContextIntent {
	/** An inner surface already took this event (`event.defaultPrevented`). */
	handled: boolean;
	/** Raised from the keyboard (the ContextMenu key or Shift+F10) rather than a pointer. */
	keyboard: boolean;
	/** Shift was held on a pointer right-click — the reader asked for the browser's own menu. */
	shiftKey: boolean;
	/** The event landed in a text field or contenteditable region. */
	editable: boolean;
	/** The reader has a text selection inside the surface. */
	selecting: boolean;
}

/** A viewport point in CSS px. */
export interface ContextPoint {
	x: number;
	y: number;
}
// #endregion

/** How long after a ContextMenu / Shift+F10 keydown a `contextmenu` event still counts as keyboard-raised. */
export const KEYBOARD_CONTEXT_WINDOW_MS = 1000;

/**
 * Whether a surface's custom menu should take a `contextmenu` event. The browser keeps the event when
 * an inner surface already handled it, when Shift is held on a pointer right-click, inside editable
 * text (spell-check and paste live there), and over a live selection (the reader wants Copy).
 */
export function shouldOpenContextMenu(intent: ContextIntent): boolean {
	if (intent.handled) return false;
	if (intent.shiftKey && !intent.keyboard) return false;
	if (intent.editable || intent.selecting) return false;
	return true;
}

/** Whether a keydown is one of the two platform chords that raise a `contextmenu` event. */
export function isContextMenuKey(key: string, shiftKey: boolean): boolean {
	return key === "ContextMenu" || (key === "F10" && shiftKey);
}

/** The surface element a {@link ContextSurfaceSource} currently points at. */
export function resolveSurface(source: ContextSurfaceSource | undefined): HTMLElement | null {
	if (!source) return null;
	return typeof source === "function" ? source() : source.current;
}
