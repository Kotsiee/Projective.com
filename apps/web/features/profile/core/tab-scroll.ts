import { readStored, removeStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";

/**
 * tab-scroll — where the page lands after a profile TAB switch.
 *
 * The four section tabs are real anchors, so switching one is a full document load (root CLAUDE.md
 * §8 Decision #52) and the browser starts the new document at the top — a reader who was three
 * screens into Work, and clicked Reviews in the pinned tab bar, is thrown back to the hero and has
 * to scroll past everything they already read. The hand-off is a `sessionStorage` note the leaving
 * page writes as its anchor navigates and the arriving page reads once on mount.
 *
 * # The rule
 *
 * Everything ABOVE the tab bar is identical on every section (hero · context bar · services ·
 * products), so the bar's own document offset is the same number on both pages and the only thing
 * that changes is the content beneath it. Given the position the reader left from:
 *
 *  - **Still inside the tab content** (the position exists on the new page, i.e. it is within the
 *    document's scroll range) → restore it exactly and at once. Nothing they were looking at above
 *    the fold has moved; only the section under the bar changed, which is what they asked for.
 *  - **Misaligned** (the new section is SHORTER than where they were, so the position would be
 *    clamped to a page bottom they never chose) → land at the top of the tab container, with the
 *    bar pinned and the new section's first row directly beneath it. That is the last place both
 *    pages agree, and the one place a section's content can be read from the start.
 *
 * Pure over numbers so it is testable at a fixed geometry; the island supplies the DOM.
 */

// #region The note
/** What the leaving page records. */
export interface TabScrollNote {
	/** The profile whose tab was switched — a note from another profile is somebody else's page. */
	handle: string;
	/**
	 * How far the reader was BELOW the tab bar's natural top, in px (`scrollY − sentinelDocTop`) —
	 * RELATIVE, never the absolute `scrollY`: in the authenticated frame the migrated header band
	 * grows its grid row when it reveals and shifts everything beneath it by its own height, and the
	 * arriving page runs its landing BEFORE that reveal while the leaving page measured AFTER it.
	 * A distance from the bar survives that shift (scroll anchoring moves the bar and the reader
	 * together); an absolute position lands one band-height into the wrong content.
	 */
	offset: number;
	/** Epoch ms — a stale note (a tab left open overnight) is not a navigation. */
	at: number;
}

/** A note older than this is ignored: it was written for a navigation that did not happen. */
export const TAB_SCROLL_NOTE_TTL_MS = 30_000;

/** Record the leaving position. Called from the tab anchor's click, before the document unloads. */
export function noteTabScroll(note: TabScrollNote): void {
	writeStored("session", SessionKeys.PROFILE_TAB_SCROLL, JSON.stringify(note));
}

/** Read and CONSUME the note; `null` when there is none, it is malformed, or it has gone stale. */
export function takeTabScroll(nowMs: number = Date.now()): TabScrollNote | null {
	const raw = readStored("session", SessionKeys.PROFILE_TAB_SCROLL);
	if (raw === null) return null;
	removeStored("session", SessionKeys.PROFILE_TAB_SCROLL);
	try {
		const parsed = JSON.parse(raw) as Partial<TabScrollNote>;
		if (
			typeof parsed.handle !== "string" ||
			typeof parsed.offset !== "number" || !Number.isFinite(parsed.offset) ||
			typeof parsed.at !== "number" || nowMs - parsed.at > TAB_SCROLL_NOTE_TTL_MS
		) return null;
		return {
			handle: parsed.handle,
			offset: parsed.offset,
			at: parsed.at,
		};
	} catch {
		return null;
	}
}
// #endregion

// #region The landing
/** What the arriving page does with the note. */
export interface TabScrollLanding {
	/** The position to settle at. */
	top: number;
	/**
	 * `keep` — the reader's own position, restored as-is and at once. `anchor` — the top of the
	 * tab container, because the position no longer exists on this section: the page is first placed
	 * at `from` (as close to where they were as this document reaches) and then ADJUSTED to `top`,
	 * smoothly where motion is allowed, so the correction reads as a settle rather than a jump.
	 */
	mode: "keep" | "anchor";
	/** `anchor` only: the instant placement the adjustment starts from. */
	from?: number;
}

/**
 * Decide the landing for the arriving page.
 *
 * Everything is measured on the ARRIVING page: `barTop` is the tab bar's natural document offset
 * there (the note's `offset` is added to it), `pinned` the line it pins at, `maxScroll` the
 * document's scroll range. The bar's natural top is the one number both pages share, which is
 * what makes a distance from it portable.
 */
export function tabScrollLanding(
	note: Pick<TabScrollNote, "offset">,
	geometry: { barTop: number; pinned: number; maxScroll: number },
): TabScrollLanding {
	const anchor = Math.max(0, Math.min(geometry.barTop - geometry.pinned, geometry.maxScroll));
	const wanted = Math.max(0, geometry.barTop + note.offset);
	// Inside the tab content and still on the page → keep. A position ABOVE the bar is kept too:
	// nothing up there changed, and moving the reader would be a jump they did not ask for.
	if (wanted <= geometry.maxScroll) return { top: wanted, mode: "keep" };
	// The new section is shorter than where they were: the container's top is the last shared place.
	// Start from the nearest position this document has (its bottom) so the adjustment is a short
	// settle upward, not a leap from the hero.
	return { top: anchor, mode: "anchor", from: Math.max(anchor, geometry.maxScroll) };
}
// #endregion
