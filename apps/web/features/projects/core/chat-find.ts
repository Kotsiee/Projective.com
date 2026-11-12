import type { ChatMessage } from "../types/projects-types.ts";

/**
 * chat-find — the in-thread message finder's rules (Decision #418): what a query matches, the order
 * the matches step in, and the count the bar shows. Pure, so the finder is testable without a DOM;
 * the feed owns the state and the painting.
 *
 * Matches run newest first, because the thread opens at its newest message: the first match is the
 * one nearest the reader, and stepping "older" walks up the history.
 */

/** The parts of a message the finder reads. */
export type FindableMessage = Pick<ChatMessage, "id" | "type" | "text">;

/** Where the finder stands, as the bar reports it. */
export interface FindPosition {
	/** Index of the active match in the newest-first list, or -1 for none. */
	active: number;
	total: number;
	/** Earlier history exists that has not been loaded, so it has not been searched. */
	more: boolean;
}

/**
 * A case-insensitive, literal matcher for the reader's query, or `null` while the query is blank.
 * Literal: every regular-expression character is escaped, so `(` or `$5` finds itself.
 */
export function findPattern(query: string): RegExp | null {
	const q = query.trim();
	if (!q) return null;
	return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
}

/** The `[start, end)` runs of `text` that `pattern` matches, in order and never overlapping. */
export function matchRuns(text: string, pattern: RegExp): Array<readonly [number, number]> {
	const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
	const runs: Array<readonly [number, number]> = [];
	for (const m of text.matchAll(new RegExp(pattern.source, flags))) {
		if (m[0].length > 0) runs.push([m.index, m.index + m[0].length]);
	}
	return runs;
}

/** The ids of the authored messages whose text matches `query`, newest first. System notices never match. */
export function findMatches(messages: readonly FindableMessage[], query: string): string[] {
	const pattern = findPattern(query);
	if (!pattern) return [];
	const ids: string[] = [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.type === "user" && pattern.test(m.text)) ids.push(m.id);
	}
	return ids;
}

/**
 * The match a step lands on: `1` is the next older, `-1` the next newer, wrapping at either end.
 * With no active match (or one no longer in the list) it lands on the newest.
 */
export function stepMatch(
	matches: readonly string[],
	activeId: string | null,
	delta: 1 | -1,
): string | null {
	if (matches.length === 0) return null;
	const at = activeId === null ? -1 : matches.indexOf(activeId);
	if (at < 0) return matches[0];
	return matches[(at + delta + matches.length) % matches.length];
}

/**
 * Whether stepping older from here must load earlier history first: there is more of it, and the
 * reader is on the oldest loaded match or there is none yet.
 */
export function needsEarlier(
	matches: readonly string[],
	activeId: string | null,
	more: boolean,
): boolean {
	if (!more) return false;
	return matches.length === 0 ||
		(activeId !== null && matches.indexOf(activeId) === matches.length - 1);
}

/** The bar's count: `3 of 12`, `3 of 12+` while earlier history is unsearched, or `No matches`. */
export function findSummary({ active, total, more }: FindPosition): string {
	if (total === 0) return "No matches";
	return `${Math.max(active, 0) + 1} of ${total}${more ? "+" : ""}`;
}

/** The same position in words, for the feed's live region. */
export function findAnnouncement({ active, total, more }: FindPosition): string {
	if (total === 0) {
		return more
			? "No matches in the loaded messages. Press Enter to search earlier ones."
			: "No matches.";
	}
	const place = `Match ${Math.max(active, 0) + 1} of ${total}`;
	return more ? `${place}, earlier messages not yet searched.` : `${place}.`;
}
