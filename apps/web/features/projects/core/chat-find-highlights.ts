/// <reference lib="dom" />
import { findPattern, matchRuns } from "./chat-find.ts";

/**
 * chat-find-highlights — paints the message finder's matches with the CSS Custom Highlight API
 * (`::highlight(chat-find)` and `::highlight(chat-find-current)` in `chat-feed.css`), so no message
 * markup changes and the virtualized rows can come and go freely. Only drawn rows are painted; the
 * feed repaints as rows mount. A browser without the API keeps the finder's scroll-and-flash alone.
 */

const ALL = "chat-find";
const CURRENT = "chat-find-current";

function supported(): boolean {
	return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight === "function";
}

function rangesIn(body: HTMLElement, pattern: RegExp, into: Range[]): void {
	const nodes: Text[] = [];
	const starts: number[] = [];
	let text = "";
	const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		starts.push(text.length);
		nodes.push(node as Text);
		text += node.nodeValue ?? "";
	}
	const locate = (pos: number, end: boolean): [Text, number] => {
		let i = nodes.length - 1;
		while (i > 0 && (end ? starts[i] >= pos : starts[i] > pos)) i--;
		return [nodes[i], pos - starts[i]];
	};
	for (const [from, to] of matchRuns(text, pattern)) {
		const [startNode, startOffset] = locate(from, false);
		const [endNode, endOffset] = locate(to, true);
		const range = document.createRange();
		range.setStart(startNode, startOffset);
		range.setEnd(endNode, endOffset);
		into.push(range);
	}
}

/**
 * Paint every match of `query` in the drawn message texts under `root`, the active message's
 * matches apart from the rest. A blank query clears the paint.
 */
export function paintFindHighlights(
	root: HTMLElement,
	query: string,
	activeId: string | null,
): void {
	if (!supported()) return;
	const pattern = findPattern(query);
	if (!pattern) {
		clearFindHighlights();
		return;
	}
	const rest: Range[] = [];
	const current: Range[] = [];
	for (const row of root.querySelectorAll<HTMLElement>("[data-message-id]")) {
		const into = row.dataset.messageId === activeId ? current : rest;
		for (const body of row.querySelectorAll<HTMLElement>(".msg-bubble__text")) {
			rangesIn(body, pattern, into);
		}
	}
	CSS.highlights.set(ALL, new Highlight(...rest));
	CSS.highlights.set(CURRENT, new Highlight(...current));
}

/** Remove the finder's paint. */
export function clearFindHighlights(): void {
	if (!supported()) return;
	CSS.highlights.delete(ALL);
	CSS.highlights.delete(CURRENT);
}
