/// <reference lib="dom" />
import { createSceneImages } from "@features/inspector/core/pptx-images.ts";
import { openDeck } from "@features/inspector/core/pptx-model.ts";
import { paintSlide, paintText } from "@features/inspector/core/pptx-paint.ts";
import { openRemoteZip, type RemoteZip } from "@features/inspector/core/remote-zip.ts";
import type { ThumbOutput } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";
import { canvasBlob, paperCanvas, THUMB_PX } from "./thumb-canvas.ts";
import { docxHead } from "./docx-head.ts";

/**
 * office-thumb — the first page of a Word file and the first slide of a deck, read in ranges so the
 * rest of the file never moves. A file that carries its own thumbnail hands that over: Office drew it,
 * and nothing here can match it for accuracy or cost.
 */

const DOC_HEAD_BYTES = 256 * 1024;
const PAGE_WIDTH_PT = 612;
const PAGE_HEIGHT_PT = 792;
const PAGE_MARGIN_PT = 60;
const EMBEDDED = ["docProps/thumbnail.jpeg", "docProps/thumbnail.jpg", "docProps/thumbnail.png"];

async function embeddedThumbnail(zip: RemoteZip): Promise<Blob | null> {
	for (const path of EMBEDDED) {
		const entry = zip.find(path);
		if (!entry) continue;
		const type = path.endsWith("png") ? "image/png" : "image/jpeg";
		return new Blob([await zip.bytes(entry) as BlobPart], { type });
	}
	return null;
}

/** A Word file's first page, on paper. */
export async function renderDocx(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	const zip = await openRemoteZip(job.src, job.sizeBytes, signal);
	const embedded = await embeddedThumbnail(zip);
	if (embedded) return { blob: embedded };
	const entry = zip.find("word/document.xml");
	if (!entry) return null;
	const text = docxHead(await zip.text(entry, { limit: DOC_HEAD_BYTES }), PAGE_MARGIN_PT);
	if (!text) return null;

	const scale = THUMB_PX / PAGE_WIDTH_PT;
	const paper = paperCanvas(THUMB_PX, Math.round(PAGE_HEIGHT_PT * scale));
	if (!paper) return null;
	paper.ctx.scale(scale, scale);
	paintText(paper.ctx, text, PAGE_WIDTH_PT, PAGE_HEIGHT_PT);
	const blob = await canvasBlob(paper.canvas);
	return blob ? { blob } : null;
}

/** A deck's first slide. */
export async function renderPptx(job: ThumbJob, signal: AbortSignal): Promise<ThumbOutput | null> {
	const zip = await openRemoteZip(job.src, job.sizeBytes, signal);
	const embedded = await embeddedThumbnail(zip);
	if (embedded) return { blob: embedded };

	const deck = await openDeck(zip);
	const scene = await deck.slide(0);
	const images = createSceneImages(deck, THUMB_PX);
	try {
		const loaded = await images.load(scene);
		if (signal.aborted) return null;
		const height = Math.round(THUMB_PX * deck.height / deck.width);
		const paper = paperCanvas(THUMB_PX, height);
		if (!paper) return null;
		paintSlide(paper.ctx, scene, loaded, THUMB_PX);
		const blob = await canvasBlob(paper.canvas);
		return blob ? { blob } : null;
	} finally {
		images.dispose();
	}
}
