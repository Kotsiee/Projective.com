import type { ToggleableShortcutId } from "@projective/types/org";
import {
	isEditableTarget,
	isFocusHeaderSearchShortcut,
	isFocusLaneSearchShortcut,
	isFocusSearchShortcut,
	type ShortcutKey,
	type ShortcutTarget,
} from "@features/shell/core/shortcuts.ts";

/**
 * search-targets — which search field a search shortcut focuses (Decision #418). The host
 * (`shortcut-host.ts`) measures every registered field at keydown and this picks one, so the
 * precedence is pure and testable without a DOM.
 */

// #region Shapes
/** Where a search field sits: the page's body or header band, the side lane, or the site header. */
export type SearchTargetRole = "page" | "lane" | "header";

/** The search a keystroke asks for, and the registry id that can switch it off. */
export interface SearchIntent {
	role: SearchTargetRole;
	shortcut: ToggleableShortcutId;
}

/** One registered field as the host measured it at keydown. */
export interface SearchCandidate {
	role: SearchTargetRole;
	/** Ranks rivals of one role; higher wins. */
	priority: number;
	/** Registration order; among equal priorities the newest wins, as a dialog's field mounts last. */
	seq: number;
	/** Rendered, connected and not behind a modal. */
	available: boolean;
}
// #endregion

// #region Rules
/**
 * The search a keystroke asks for, or `null`. A bare `/` is the page's and never fires from a field,
 * where it is text. The two chords carry a command modifier, so they fire from anywhere.
 */
export function searchIntentOf(
	event: ShortcutKey,
	target: ShortcutTarget | null,
): SearchIntent | null {
	if (isFocusLaneSearchShortcut(event)) return { role: "lane", shortcut: "focus-lane-search" };
	if (isFocusHeaderSearchShortcut(event)) {
		return { role: "header", shortcut: "focus-header-search" };
	}
	if (isFocusSearchShortcut(event) && !isEditableTarget(target)) {
		return { role: "page", shortcut: "focus-search" };
	}
	return null;
}

function bestOf<T extends SearchCandidate>(
	role: SearchTargetRole,
	candidates: readonly T[],
): T | null {
	let best: T | null = null;
	for (const c of candidates) {
		if (!c.available || c.role !== role) continue;
		if (!best || c.priority > best.priority || (c.priority === best.priority && c.seq > best.seq)) {
			best = c;
		}
	}
	return best;
}

/**
 * The candidate a search shortcut focuses, or `null` to let the key through untouched. A page
 * without a search of its own hands `/` to the header's, so `/` means "search" wherever one exists;
 * the lane and header chords only ever reach their own role.
 */
export function pickSearchTarget<T extends SearchCandidate>(
	role: SearchTargetRole,
	candidates: readonly T[],
): T | null {
	return bestOf(role, candidates) ?? (role === "page" ? bestOf("header", candidates) : null);
}
// #endregion
