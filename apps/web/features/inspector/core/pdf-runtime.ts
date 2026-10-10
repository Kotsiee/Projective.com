/**
 * pdf-runtime — pdf.js (legacy build) with its worker and vendored decoders wired up.
 *
 * **Never import this module statically**: pdf.js touches browser globals while it evaluates. The
 * only entry is {@link ./pdf-loader.ts | `loadPdfRuntime`}. Bytes come only from the asset's
 * same-origin proxy address; the wasm decoders, CMaps, standard fonts and ICC profiles from the
 * versioned `/vendor/pdfjs/` tree.
 */
import {
	getDocument,
	GlobalWorkerOptions,
	PasswordResponses,
	TextLayer,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFJS_CMAPS, PDFJS_ICCS, PDFJS_STANDARD_FONTS, PDFJS_WASM } from "./vendor-paths.ts";

GlobalWorkerOptions.workerSrc =
	new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;

export { TextLayer };

/** Why pdf.js wants a password: none was given yet, or the last one was wrong. */
export type PasswordReason = "required" | "incorrect";

/** Asked when the document is encrypted; call `submit` with the password to continue. */
export type PasswordHandler = (reason: PasswordReason, submit: (password: string) => void) => void;

/** Start loading a PDF from a same-origin address. Destroy the task to abort it and end its worker. */
export function openPdf(src: string, onPassword: PasswordHandler): PDFDocumentLoadingTask {
	const task = getDocument({
		url: src,
		wasmUrl: PDFJS_WASM,
		cMapUrl: PDFJS_CMAPS,
		cMapPacked: true,
		standardFontDataUrl: PDFJS_STANDARD_FONTS,
		iccUrl: PDFJS_ICCS,
		enableXfa: false,
	});
	task.onPassword = (update: (password: string) => void, code: number) => {
		onPassword(code === PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "required", update);
	};
	return task;
}

function errorName(error: unknown): string {
	if (error instanceof Error) return error.name;
	if (typeof error === "object" && error !== null && "name" in error) {
		const name = error.name;
		return typeof name === "string" ? name : "";
	}
	return "";
}

/** Whether an error only says that a render, a text layer or the whole load was cancelled. */
export function isCancellation(error: unknown): boolean {
	const name = errorName(error);
	return name === "RenderingCancelledException" || name === "AbortException";
}

/** A reader-facing reason a document could not be opened. */
export function describeFailure(error: unknown): string {
	switch (errorName(error)) {
		case "InvalidPDFException":
			return "This file isn't a readable PDF. It may be damaged or only named like one.";
		case "ResponseException":
			return "The file couldn't be fetched. Check your connection, then reload the page.";
		case "PasswordException":
			return "This PDF is password-protected and couldn't be opened.";
		default:
			return "This PDF couldn't be shown here. You can still download it.";
	}
}
