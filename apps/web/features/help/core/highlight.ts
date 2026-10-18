import type { HelpCentreHighlight } from "@projective/types/editorial";

/**
 * highlight.ts — turn the search API's highlight runs into text segments for `<mark>` (P2). Pure, so
 * the server-rendered fallback list and the overlay render a hit identically.
 *
 * The runs arrive as `[start, end)` offsets into the string the server sent. They are defended
 * against, not trusted: clamped to the string, empty ones dropped, overlaps merged and sorted — a
 * malformed run can never duplicate or lose text, only fail to mark it.
 */

/** One piece of a highlighted string. */
export interface HighlightSegment {
	text: string;
	mark: boolean;
}

/** Split `text` into marked and unmarked segments by `runs`. The segments always rejoin to `text`. */
export function highlightSegments(
	text: string,
	runs: readonly HelpCentreHighlight[],
): HighlightSegment[] {
	const clean = runs
		.map(([start, end]): [number, number] => [
			Math.max(0, Math.min(text.length, Math.floor(start))),
			Math.max(0, Math.min(text.length, Math.floor(end))),
		])
		.filter(([start, end]) => end > start)
		.sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const run of clean) {
		const last = merged[merged.length - 1];
		if (last && run[0] <= last[1]) last[1] = Math.max(last[1], run[1]);
		else merged.push([run[0], run[1]]);
	}
	const segments: HighlightSegment[] = [];
	let at = 0;
	for (const [start, end] of merged) {
		if (start > at) segments.push({ text: text.slice(at, start), mark: false });
		segments.push({ text: text.slice(start, end), mark: true });
		at = end;
	}
	if (at < text.length || segments.length === 0) {
		segments.push({ text: text.slice(at), mark: false });
	}
	return segments;
}
