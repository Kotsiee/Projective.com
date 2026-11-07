import type { ThumbOutput } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";

/**
 * thumb-render — the door to the renderers. Each is imported on first use, so a folder of images
 * loads none of them and a folder with one PDF loads only pdf.js, and `/files` itself ships none.
 * A renderer resolves `null` for a file it cannot draw; the card keeps its tile.
 */
export async function renderThumb(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	switch (job.renderer) {
		case "text":
			return await (await import("./text-thumb.ts")).renderText(job, signal);
		case "csv":
			return await (await import("./text-thumb.ts")).renderCsv(job, signal);
		case "sheet":
			return await (await import("./sheet-thumb.ts")).renderSheet(job, signal);
		case "pdf":
			return await (await import("./pdf-thumb.ts")).renderPdf(job, signal);
		case "docx":
			return await (await import("./office-thumb.ts")).renderDocx(job, signal);
		case "pptx":
			return await (await import("./office-thumb.ts")).renderPptx(job, signal);
		case "video":
			return await (await import("./video-thumb.ts")).renderVideo(job, signal);
		case "model":
			return await (await import("./model-thumb.ts")).renderModel(job, signal);
		case "texture":
			return await (await import("./texture-thumb.ts")).renderTexture(job, signal);
	}
}
