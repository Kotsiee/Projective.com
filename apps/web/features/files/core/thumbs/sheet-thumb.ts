/// <reference lib="dom" />
import { openWorkbook } from "@features/inspector/core/sheet-client.ts";
import type { ThumbOutput } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";
import { canvasBlob, paintTable } from "./thumb-canvas.ts";

const PREVIEW_ROWS = 14;

/** The top of a workbook's first sheet, parsed in the sheet worker with its row limit on. */
export async function renderSheet(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	const res = await fetch(job.src, { credentials: "same-origin", signal });
	if (!res.ok) {
		await res.body?.cancel();
		return null;
	}
	const book = await openWorkbook(await res.arrayBuffer(), { previewRows: PREVIEW_ROWS });
	try {
		const sheet = await book.sheet(0);
		if (sheet.rows.length === 0) return null;
		const canvas = paintTable(sheet.rows);
		const blob = canvas ? await canvasBlob(canvas) : null;
		return blob ? { blob } : null;
	} finally {
		book.close();
	}
}
