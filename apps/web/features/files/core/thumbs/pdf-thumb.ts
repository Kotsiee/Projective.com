/// <reference lib="dom" />
import { loadPdfRuntime } from "@features/inspector/core/pdf-loader.ts";
import type { ThumbOutput } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";
import { canvasBlob, THUMB_PX } from "./thumb-canvas.ts";

/**
 * pdf-thumb — page 1 at card size. pdf.js reads the file in ranges with auto-fetch off, so a 900 MB
 * PDF costs its first page, and one shared worker serves every thumbnail. A password-protected file
 * asks for a password no card can give, so that ends the job and the tile stays.
 */
export async function renderPdf(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	const { openPdfForThumbnail } = await loadPdfRuntime();
	const task = openPdfForThumbnail(job.src);
	const stop = () => void task.destroy();
	signal.addEventListener("abort", stop, { once: true });
	try {
		const doc = await task.promise;
		const page = await doc.getPage(1);
		const unit = page.getViewport({ scale: 1 });
		const scale = THUMB_PX / Math.max(unit.width, unit.height * 0.75);
		const viewport = page.getViewport({ scale });
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(viewport.width);
		canvas.height = Math.ceil(viewport.height);
		await page.render({ canvas, viewport }).promise;
		page.cleanup();
		const blob = await canvasBlob(canvas);
		return blob ? { blob } : null;
	} finally {
		signal.removeEventListener("abort", stop);
		await task.destroy().catch(() => undefined);
	}
}
