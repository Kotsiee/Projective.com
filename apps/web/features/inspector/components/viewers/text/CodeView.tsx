import type { JSX } from "preact";
import { useComputed } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import {
	escapeHtml,
	type FindMatch,
	highlightedLines,
	lineFromHash,
	type MarkRange,
	markRanges,
} from "../../../core/code-lines.ts";
import { loadHighlighter } from "../../../core/highlight-loader.ts";
import {
	type CodeView as CodeViewState,
	FONT_STEPS,
	requestFocus,
	selectLine,
	stepFont,
	stepMatch,
} from "./text-tools.ts";
import { useStageKeys } from "./use-stage-keys.ts";

/** Lines per rendered block; each block is skipped by layout while off screen. */
const CHUNK_LINES = 200;

const baseChunkCache = new WeakMap<readonly string[], string[]>();

function lineHtml(index: number, body: string): string {
	const n = index + 1;
	return `<div class="ins-code__line" id="L${n}" data-line="${n}"><span class="ins-code__ln" aria-hidden="true">${n}</span><span class="ins-code__src">${body}</span></div>`;
}

function chunkHtml(
	html: readonly string[],
	chunk: number,
	marks?: Map<number, MarkRange[]>,
): string {
	const start = chunk * CHUNK_LINES;
	const end = Math.min(start + CHUNK_LINES, html.length);
	let out = "";
	for (let i = start; i < end; i++) {
		const ranges = marks?.get(i);
		out += lineHtml(i, ranges ? markRanges(html[i], ranges) : html[i]);
	}
	return out;
}

function baseChunks(html: readonly string[]): string[] {
	const cached = baseChunkCache.get(html);
	if (cached) return cached;
	const count = Math.ceil(html.length / CHUNK_LINES);
	const chunks = Array.from({ length: count }, (_, c) => chunkHtml(html, c));
	baseChunkCache.set(html, chunks);
	return chunks;
}

function markedChunks(
	html: readonly string[],
	matches: readonly FindMatch[],
	current: number,
): string[] {
	const chunks = baseChunks(html);
	if (matches.length === 0) return chunks;
	const byChunk = new Map<number, Map<number, MarkRange[]>>();
	matches.forEach((m, i) => {
		const chunk = Math.floor(m.line / CHUNK_LINES);
		let lines = byChunk.get(chunk);
		if (!lines) {
			lines = new Map();
			byChunk.set(chunk, lines);
		}
		const ranges = lines.get(m.line) ?? [];
		ranges.push({ start: m.start, end: m.end, current: i === current });
		lines.set(m.line, ranges);
	});
	return chunks.map((base, c) => {
		const marks = byChunk.get(c);
		return marks ? chunkHtml(html, c, marks) : base;
	});
}

/** Props for {@link CodeView}. */
export interface CodeViewProps {
	shell: InspectorShell;
	view: CodeViewState;
	/** Select the line a `#L12` fragment names once the lines are drawn (only when the view syncs the URL). */
	followHash?: boolean;
	/** Extra stage keys, tried before the view's own. */
	onKey?: (event: KeyboardEvent) => boolean;
}

/**
 * A line-numbered source view: lines drawn in blocks the browser skips while off screen, a sticky
 * gutter whose numbers select a line (`#L12`), wrap and text-size settings, and find matches
 * marked in place. Colours the text with highlight.js when the view has a grammar, falling back to
 * plain text when the grammar cannot load.
 */
export function CodeView({ shell, view, followHash = false, onKey }: CodeViewProps): JSX.Element {
	const scroller = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const chunks = useComputed(() => {
		const html = view.html.value;
		return html ? markedChunks(html, view.matches.value, view.current.value) : null;
	});

	// #region Prepare
	useEffect(() => {
		const markReady = () => {
			if (shell.status.peek() === "loading") shell.status.value = "ready";
		};
		if (view.html.peek() !== null) {
			markReady();
			return;
		}
		const lines = view.lines.peek();
		const plain = () => lines.map(escapeHtml);
		const language = view.language;
		if (!language) {
			view.html.value = plain();
			markReady();
			return;
		}
		let live = true;
		loadHighlighter()
			.then(async (runtime) => {
				const html = await runtime.highlightCode(lines.join("\n"), language);
				return { html, name: runtime.languageLabel(language) };
			})
			.then(({ html, name }) => {
				if (!live) return;
				view.html.value = html === null ? plain() : highlightedLines(html, lines.length);
				view.languageName.value = html === null ? null : name;
				markReady();
			})
			.catch(() => {
				if (!live) return;
				view.html.value = plain();
				shell.announce("Syntax colours couldn't load, so the file is shown as plain text.");
				markReady();
			});
		return () => {
			live = false;
		};
	}, [shell, view]);
	// #endregion

	// #region Line selection
	const drawn = chunks.value !== null;
	const selected = view.selected.value;
	const reveal = view.reveal.value;
	const chunkList = chunks.value;

	useEffect(() => {
		if (!drawn || !followHash || !view.urlSync || view.selected.peek() !== null) return;
		const line = lineFromHash(location.hash);
		if (line !== null && line <= view.lines.peek().length) selectLine(view, line, true);
	}, [drawn]);

	useEffect(() => {
		const root = body.current;
		if (!root) return;
		root.querySelector('[aria-current="true"]')?.removeAttribute("aria-current");
		if (selected !== null) {
			root.querySelector(`#L${selected}`)?.setAttribute("aria-current", "true");
		}
	}, [selected, chunkList]);

	useEffect(() => {
		if (!drawn || !reveal) return;
		body.current?.querySelector(`#L${reveal.line}`)?.scrollIntoView({ block: "center" });
	}, [reveal, drawn]);

	useEffect(() => {
		if (!drawn || view.matchReveal.peek() === 0) return;
		body.current?.querySelector(".ins-code__match--current")?.scrollIntoView({
			block: "center",
			inline: "nearest",
		});
	}, [view.matchReveal.value, drawn]);

	const onClick = (event: MouseEvent) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const gutter = target.closest(".ins-code__ln");
		const line = Number(gutter?.parentElement?.getAttribute("data-line"));
		if (!gutter || !Number.isInteger(line) || line < 1) return;
		const next = view.selected.peek() === line ? null : line;
		selectLine(view, next, false);
		shell.announce(next === null ? "Line selection cleared" : `Line ${next} selected`);
	};
	// #endregion

	// #region Text size
	const fontStep = view.fontStep.value;
	useEffect(() => {
		const node = body.current;
		if (!node) return;
		const px = Number.parseFloat(getComputedStyle(node).fontSize);
		view.fontPx.value = Number.isFinite(px) ? Math.round(px) : null;
	}, [fontStep, drawn]);
	// #endregion

	// #region Keys
	useStageKeys(scroller, scroller, (event) => {
		if (onKey?.(event)) return true;
		const mod = event.ctrlKey || event.metaKey;
		if (mod && !event.altKey && (event.key === "f" || event.key === "F")) {
			requestFocus(shell, view, "find");
			return true;
		}
		if (mod && !event.altKey && (event.key === "a" || event.key === "A")) {
			const node = body.current;
			const selection = globalThis.getSelection?.();
			if (!node || !selection) return false;
			const range = document.createRange();
			range.selectNodeContents(node);
			selection.removeAllRanges();
			selection.addRange(range);
			return true;
		}
		if (mod || event.altKey) return false;
		switch (event.key) {
			case "+":
			case "=":
				if (stepFont(view, 1)) shell.announce("Larger text");
				return true;
			case "-":
			case "_":
				if (stepFont(view, -1)) shell.announce("Smaller text");
				return true;
			case "w":
			case "W":
				view.wrap.value = !view.wrap.peek();
				shell.announce(view.wrap.peek() ? "Wrapping long lines" : "Not wrapping long lines");
				return true;
			case "g":
			case "G":
				requestFocus(shell, view, "goto");
				return true;
			case "n":
			case "N": {
				const said = stepMatch(view, event.shiftKey ? -1 : 1);
				if (said) shell.announce(said);
				return said !== null;
			}
			case "Escape":
				if (view.selected.peek() === null) return false;
				selectLine(view, null, false);
				shell.announce("Line selection cleared");
				return true;
			default:
				return false;
		}
	});
	// #endregion

	const lineCount = view.lines.value.length;
	return (
		<div
			ref={scroller}
			class="ins-code"
			data-wrap={view.wrap.value ? "true" : "false"}
			data-numbers={view.lineNumbers.value ? "true" : "false"}
			style={{
				"--ins-code-fs": FONT_STEPS[fontStep],
				"--ins-code-digits": String(Math.max(2, String(lineCount).length)),
			}}
		>
			<div ref={body} class="ins-code__body" onClick={onClick}>
				{chunkList?.map((html, c) => (
					<div
						key={c}
						class="ins-code__chunk"
						style={{
							"--ins-code-chunk-lines": String(
								Math.min(CHUNK_LINES, lineCount - c * CHUNK_LINES),
							),
						}}
						dangerouslySetInnerHTML={{ __html: html }}
					/>
				))}
			</div>
		</div>
	);
}
