/// <reference lib="dom" />
import { looksBinary, normalizeNewlines } from "@features/inspector/core/code-lines.ts";
import { parseCsv } from "@features/inspector/core/csv.ts";
import type { ThumbOutput } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";
import { canvasBlob, paintTable } from "./thumb-canvas.ts";

/**
 * text-thumb — the start of a text file. A `Range` read of a few kilobytes, whatever the file's size,
 * which is why these jobs run on the light lane.
 */

const SNIPPET_BYTES = 4 * 1024;
const TABLE_BYTES = 32 * 1024;
const SNIPPET_LINES = 10;
const SNIPPET_COLUMNS = 80;
const TABLE_ROWS = 14;

async function readHead(job: ThumbJob, bytes: number, signal: AbortSignal): Promise<string | null> {
	const res = await fetch(job.src, {
		headers: { range: `bytes=0-${bytes - 1}` },
		credentials: "same-origin",
		signal,
	});
	if (!res.ok) {
		await res.body?.cancel();
		return null;
	}
	const text = await res.text();
	return looksBinary(text) ? null : normalizeNewlines(text);
}

/** The lines of a file's start, the last one left out when a read may have cut it short. */
export function snippetLines(text: string, complete: boolean): string[] {
	const lines = text.split("\n");
	if (!complete && lines.length > 1) lines.pop();
	while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) lines.pop();
	return lines.slice(0, SNIPPET_LINES).map((line) => line.slice(0, SNIPPET_COLUMNS));
}

/** The first lines of a code or text file, drawn live so they follow the theme. */
export async function renderText(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	const text = await readHead(job, SNIPPET_BYTES, signal);
	if (text === null) return null;
	const lines = snippetLines(text, job.sizeBytes <= SNIPPET_BYTES);
	return lines.length > 0 ? { lines } : null;
}

/** The first rows of a CSV as a small sheet. */
export async function renderCsv(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	const text = await readHead(job, TABLE_BYTES, signal);
	if (text === null) return null;
	const complete = job.sizeBytes <= TABLE_BYTES;
	const cut = complete ? text : text.slice(0, Math.max(0, text.lastIndexOf("\n")));
	const { rows } = parseCsv(cut, { delimiter: job.delimiter ?? ",", maxRows: TABLE_ROWS });
	if (rows.length === 0) return null;
	const canvas = paintTable(rows);
	const blob = canvas ? await canvasBlob(canvas) : null;
	return blob ? { blob } : null;
}
