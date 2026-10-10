/// <reference lib="dom" />
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { type PrintFit, printOrientation, printScale } from "../../../core/pdf-print.ts";
import { releaseCanvas } from "./pdf-page-view.ts";

/**
 * pdf-print-job — prints a PDF without a frame or a new window: each chosen page is rasterised to an
 * offscreen canvas, kept as a `blob:` image inside `#ins-print-root`, and `styles/inspector-print.css`
 * shows only that root while printing. The root is the inspector's shared print contract: one
 * element with that id, appended to `<body>` while printing and removed afterwards.
 */

/** The id `inspector-print.css` prints in place of the page. */
export const PRINT_ROOT_ID = "ins-print-root";

/** What to rasterise. */
export interface PrintJobOptions {
	/** 1-based page numbers, in print order. */
	pages: readonly number[];
	dpi: number;
	fit: PrintFit;
	signal: AbortSignal;
	onProgress(done: number, total: number): void;
}

/** A prepared print root; `dispose` removes it and frees its images. */
export interface PreparedPrint {
	readonly root: HTMLElement;
	dispose(): void;
}

function abortError(): DOMException {
	return new DOMException("Printing was cancelled.", "AbortError");
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error("A page could not be encoded for printing."));
		}, "image/png");
	});
}

/** Rasterise the chosen pages into a detached print root. Rejects with an `AbortError` on cancel. */
export async function preparePrint(
	doc: PDFDocumentProxy,
	options: PrintJobOptions,
): Promise<PreparedPrint> {
	const { pages, dpi, fit, signal, onProgress } = options;
	const urls: string[] = [];
	const root = document.createElement("div");
	root.id = PRINT_ROOT_ID;
	root.dataset.fit = fit;
	root.setAttribute("aria-hidden", "true");
	const dispose = () => {
		root.remove();
		for (const url of urls.splice(0)) URL.revokeObjectURL(url);
	};
	try {
		for (let i = 0; i < pages.length; i++) {
			if (signal.aborted) throw abortError();
			onProgress(i, pages.length);
			const page = await doc.getPage(pages[i]);
			const unit = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: printScale(unit.width, unit.height, dpi) });
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.floor(viewport.width));
			canvas.height = Math.max(1, Math.floor(viewport.height));
			try {
				await page.render({ canvas, viewport, intent: "print" }).promise;
				if (signal.aborted) throw abortError();
				urls.push(URL.createObjectURL(await toBlob(canvas)));
			} finally {
				releaseCanvas(canvas);
			}
			const sheet = document.createElement("div");
			sheet.className = `ins-print-page ins-print-page--${
				printOrientation(unit.width, unit.height)
			}`;
			sheet.style.setProperty("--ins-print-w", `${unit.width}pt`);
			sheet.style.setProperty("--ins-print-h", `${unit.height}pt`);
			const image = document.createElement("img");
			image.className = "ins-print-page__image";
			image.alt = "";
			image.src = urls[urls.length - 1];
			sheet.append(image);
			root.append(sheet);
		}
		onProgress(pages.length, pages.length);
		document.getElementById(PRINT_ROOT_ID)?.remove();
		document.body.append(root);
		const decoded = await Promise.allSettled(
			[...root.querySelectorAll("img")].map((image) => image.decode()),
		);
		if (decoded.some((result) => result.status === "rejected")) {
			throw new Error("A page could not be prepared for printing.");
		}
		if (signal.aborted) throw abortError();
		return { root, dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}

/** Open the browser's print dialog for a prepared root and clean it up once printing ends. */
export function printPrepared(prepared: PreparedPrint): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			globalThis.removeEventListener("afterprint", done);
			prepared.dispose();
			resolve();
		};
		globalThis.addEventListener("afterprint", done);
		globalThis.print();
	});
}

/** Whether an error is the user cancelling a print job. */
export function isAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
