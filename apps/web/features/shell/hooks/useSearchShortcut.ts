import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { isEditableTarget, type ShortcutKey } from "../core/shortcuts.ts";

export interface SearchShortcutOptions {
	/** The search form (or any wrapper) whose text field takes focus. */
	scopeRef: RefObject<HTMLElement>;
	/** The key rule — `isFocusSearchShortcut` for a page's own search, the header rule for the header's. */
	matches: (event: ShortcutKey) => boolean;
	/** Also act on a key pressed inside a field (default false — a key typed into a field is text). */
	fromFields?: boolean;
	/** Bind the shortcut at all (default true). */
	enabled?: boolean;
}

/**
 * useSearchShortcut — focus and select the search field inside `scopeRef` when `matches` claims a key.
 * Nothing happens while the field is not rendered or sits behind an open modal (an `inert`
 * background), so a dialog keeps its keys. One document listener, removed on unmount.
 */
export function useSearchShortcut(
	{ scopeRef, matches, fromFields = false, enabled = true }: SearchShortcutOptions,
): void {
	const matchesRef = useRef(matches);
	matchesRef.current = matches;

	useEffect(() => {
		if (!enabled) return;
		function onKey(e: KeyboardEvent): void {
			if (!matchesRef.current(e)) return;
			if (!fromFields && isEditableTarget(e.target instanceof Element ? e.target : null)) return;
			const field = scopeRef.current?.querySelector<HTMLInputElement>(
				"input:not([type='hidden'])",
			);
			if (!field || field.closest("[inert]") || field.getClientRects().length === 0) return;
			e.preventDefault();
			field.focus();
			field.select();
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [enabled, fromFields, scopeRef]);
}
