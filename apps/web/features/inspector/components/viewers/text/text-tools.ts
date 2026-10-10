import { computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import { INSPECT_TEXT_LIMITS } from "@projective/types/files";
import type { InspectorShell, StageFact } from "../../../core/inspector-shell.ts";
import {
	clampLine,
	FIND_LIMIT,
	type FindMatch,
	findMatches,
	readingMinutes,
	type TextStats,
} from "../../../core/code-lines.ts";
import { type CsvTable, tableRowOrder, type TableSort } from "../../../core/csv.ts";
import type { RenderedMarkdown } from "../../../core/markdown-runtime.ts";

/**
 * text-tools — the signal state behind the code, text, markdown and table canvases. Pure signals
 * (no DOM), so `createTools` stays safe during SSR; the stages and panel controls share it.
 */

// #region Code view
/** Text sizes the code view steps through, smallest first; all type-scale tokens. */
export const FONT_STEPS = [
	"var(--text-2xs)",
	"var(--text-xs)",
	"var(--text-sm)",
	"var(--text-md)",
	"var(--text-base)",
	"var(--text-lg)",
	"var(--text-xl)",
] as const;

/** The code view's starting text size (`--text-sm`). */
export const DEFAULT_FONT_STEP = 2;

/** A panel field a stage shortcut asks to focus. */
export type FocusTarget = "find" | "goto";

/** A request to scroll a 1-based line into view; `seq` makes a repeat request distinct. */
export interface LineReveal {
	line: number;
	seq: number;
}

/** State of one line-numbered source view (code, plain text, markdown source). */
export interface CodeView {
	/** highlight.js grammar to colour with; `null` draws plain text. */
	readonly language: string | null;
	/** Colouring was skipped because the file is over the highlighting ceiling. */
	readonly highlightSkipped: boolean;
	/** Mirror the selected line into the page URL (`#L12`); off when the inspector is embedded. */
	readonly urlSync: boolean;
	readonly lines: Signal<readonly string[]>;
	/** One HTML fragment per line once prepared (escaped or highlighted). */
	readonly html: Signal<readonly string[] | null>;
	/** The grammar's display name once it has coloured the file. */
	readonly languageName: Signal<string | null>;
	readonly wrap: Signal<boolean>;
	readonly lineNumbers: Signal<boolean>;
	readonly fontStep: Signal<number>;
	/** The measured text size, for the readout. */
	readonly fontPx: Signal<number | null>;
	/** The 1-based selected line (`#L12`). */
	readonly selected: Signal<number | null>;
	readonly reveal: Signal<LineReveal | null>;
	readonly query: Signal<string>;
	readonly matches: ReadonlySignal<readonly FindMatch[]>;
	/** Index of the active match in {@link CodeView.matches}. */
	readonly current: Signal<number>;
	/** Bumped whenever the active match should be scrolled into view. */
	readonly matchReveal: Signal<number>;
	readonly gotoValue: Signal<string>;
	readonly focus: Signal<FocusTarget | null>;
}

/** Create a code view; `language` is dropped (plain text) for files over the highlighting ceiling. */
export function createCodeView(
	language: string | null,
	sizeBytes: number,
	urlSync = true,
): CodeView {
	const wanted = language !== null && language !== "plaintext" ? language : null;
	const highlightSkipped = wanted !== null && sizeBytes > INSPECT_TEXT_LIMITS.highlightBytes;
	const lines = signal<readonly string[]>([]);
	const query = signal("");
	return {
		language: highlightSkipped ? null : wanted,
		highlightSkipped,
		urlSync,
		lines,
		html: signal<readonly string[] | null>(null),
		languageName: signal<string | null>(null),
		wrap: signal(false),
		lineNumbers: signal(true),
		fontStep: signal(DEFAULT_FONT_STEP),
		fontPx: signal<number | null>(null),
		selected: signal<number | null>(null),
		reveal: signal<LineReveal | null>(null),
		query,
		matches: computed(() => findMatches(lines.value, query.value)),
		current: signal(0),
		matchReveal: signal(0),
		gotoValue: signal(""),
		focus: signal<FocusTarget | null>(null),
	};
}

/** Step the text size by `delta`, within {@link FONT_STEPS}. Returns whether it changed. */
export function stepFont(view: CodeView, delta: number): boolean {
	const next = Math.min(Math.max(view.fontStep.peek() + delta, 0), FONT_STEPS.length - 1);
	if (next === view.fontStep.peek()) return false;
	view.fontStep.value = next;
	return true;
}

/** Select a line (or clear with `null`), mirror it into the URL fragment and scroll to it. */
export function selectLine(view: CodeView, line: number | null, reveal: boolean): void {
	view.selected.value = line;
	if (line !== null && reveal) {
		view.reveal.value = { line, seq: (view.reveal.peek()?.seq ?? 0) + 1 };
	}
	if (!view.urlSync) return;
	if (typeof history === "undefined" || typeof location === "undefined") return;
	const base = `${location.pathname}${location.search}`;
	history.replaceState(history.state, "", line === null ? base : `${base}#L${line}`);
}

/** Jump to the line typed into Go to line; returns the line reached, or `null` when not a number. */
export function goToTypedLine(view: CodeView): number | null {
	const raw = view.gotoValue.peek().trim();
	if (raw.length === 0) return null;
	const line = clampLine(Number(raw), view.lines.peek().length);
	if (line === null) return null;
	selectLine(view, line, true);
	return line;
}

/** Start a new search: the first match becomes active and is scrolled to. */
export function setQuery(view: CodeView, query: string): void {
	view.query.value = query;
	view.current.value = 0;
	view.matchReveal.value++;
}

/** Move the active match by `delta`, wrapping; returns the announcement, or `null` with no matches. */
export function stepMatch(view: CodeView, delta: number): string | null {
	const total = view.matches.peek().length;
	if (total === 0) return null;
	const next = (view.current.peek() + delta + total) % total;
	view.current.value = next;
	view.matchReveal.value++;
	return `Match ${next + 1} of ${total}${total >= FIND_LIMIT ? "+" : ""}`;
}

/** The find readout: `"3 of 12"`, `"No matches"`, or empty with no query. */
export function matchSummary(view: CodeView): string {
	if (view.query.value.length === 0) return "";
	const total = view.matches.value.length;
	if (total === 0) return "No matches";
	return `${Math.min(view.current.value, total - 1) + 1} of ${total}${
		total >= FIND_LIMIT ? "+" : ""
	}`;
}
// #endregion

// #region Viewer tools
/** Ask the panel to show and focus one of its fields. */
export function requestFocus(shell: InspectorShell, view: CodeView, target: FocusTarget): void {
	shell.panelOpen.value = true;
	view.focus.value = target;
}

/** Fail fast (before any fetch) when the file is over the text ceiling. Returns whether it fits. */
export function guardTextSize(shell: InspectorShell): boolean {
	if (shell.asset.sizeBytes <= INSPECT_TEXT_LIMITS.textBytes) return true;
	if (shell.status.peek() !== "error") {
		shell.fail("This file is too large to preview. Download it to open it on your device.");
	}
	return false;
}

/** Tools of the code and plain-text canvases. */
export interface CodeTools {
	readonly text: Signal<string | null>;
	readonly view: CodeView;
}

/** Tools of the markdown canvas: the rendered document plus a source view. */
export interface MarkdownTools {
	readonly text: Signal<string | null>;
	readonly mode: Signal<"rendered" | "source">;
	readonly rendered: Signal<RenderedMarkdown | null>;
	readonly view: CodeView;
}

/** Tools of the table canvas. */
export interface TableTools {
	readonly text: Signal<string | null>;
	readonly delimiter: "," | "\t";
	readonly table: Signal<CsvTable | null>;
	readonly header: Signal<boolean>;
	readonly filter: Signal<string>;
	readonly sort: Signal<TableSort | null>;
	/** Indexes into `table.rows` of the body rows to show, filtered and ordered. */
	readonly order: ReadonlySignal<readonly number[]>;
	readonly focus: Signal<boolean>;
}

/** Tools for `code` (highlighted) or `text` (plain) files. */
export function createCodeTools(shell: InspectorShell, highlight: boolean): CodeTools {
	guardTextSize(shell);
	const { asset } = shell;
	return {
		text: signal<string | null>(null),
		view: createCodeView(
			highlight ? asset.language : null,
			asset.sizeBytes,
			shell.options.urlSync,
		),
	};
}

/** Tools for markdown files. */
export function createMarkdownTools(shell: InspectorShell): MarkdownTools {
	guardTextSize(shell);
	return {
		text: signal<string | null>(null),
		mode: signal<"rendered" | "source">("rendered"),
		rendered: signal<RenderedMarkdown | null>(null),
		view: createCodeView(
			shell.asset.language ?? "markdown",
			shell.asset.sizeBytes,
			shell.options.urlSync,
		),
	};
}

/** Tools for CSV/TSV files. */
export function createTableTools(shell: InspectorShell): TableTools {
	guardTextSize(shell);
	const table = signal<CsvTable | null>(null);
	const header = signal(true);
	const filter = signal("");
	const sort = signal<TableSort | null>(null);
	return {
		text: signal<string | null>(null),
		delimiter: shell.asset.delimiter ?? ",",
		table,
		header,
		filter,
		sort,
		order: computed(() => {
			const parsed = table.value;
			if (!parsed) return [];
			return tableRowOrder(parsed.rows, {
				firstRowIsHeader: header.value,
				filter: filter.value,
				sort: sort.value,
			});
		}),
		focus: signal(false),
	};
}
// #endregion

// #region Facts
const COUNT = new Intl.NumberFormat("en-GB");

/** Format a count with grouping, e.g. `"12,480"`. */
export function formatCount(n: number): string {
	return COUNT.format(n);
}

/** Details facts for a code or text file. */
export function codeFacts(stats: TextStats, languageName: string | null): StageFact[] {
	const facts: StageFact[] = [
		{ label: "Lines", value: formatCount(stats.lines) },
		{ label: "Characters", value: formatCount(stats.characters) },
	];
	if (languageName) facts.push({ label: "Language", value: languageName });
	return facts;
}

/** Details facts for a markdown file. */
export function markdownFacts(stats: TextStats): StageFact[] {
	const minutes = readingMinutes(stats.words);
	return [
		{ label: "Words", value: formatCount(stats.words) },
		{ label: "Reading time", value: minutes === 0 ? "Under a minute" : `${minutes} min` },
		{ label: "Lines", value: formatCount(stats.lines) },
	];
}

/** Details facts for a table. */
export function tableFacts(
	table: CsvTable,
	header: boolean,
	delimiter: TableTools["delimiter"],
): StageFact[] {
	const rows = Math.max(0, table.totalRows - (header && table.totalRows > 0 ? 1 : 0));
	return [
		{ label: "Rows", value: formatCount(rows) },
		{ label: "Columns", value: formatCount(table.columns) },
		{ label: "Separator", value: delimiter === "\t" ? "Tab" : "Comma" },
	];
}

/** The truncation notice, or `null` when every row is shown. */
export function truncationNotice(table: CsvTable, header: boolean): string | null {
	if (!table.truncated) return null;
	const skip = header ? 1 : 0;
	return `Showing the first ${formatCount(Math.max(0, table.rows.length - skip))} of ${
		formatCount(Math.max(0, table.totalRows - skip))
	} rows. Download the file to see them all.`;
}
// #endregion
