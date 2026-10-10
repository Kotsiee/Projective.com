import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import { loadPdfRuntime, type PdfRuntime, warmPdfRuntime } from "../../../core/pdf-loader.ts";
import type { ViewerProps } from "../viewer.ts";
import { listenScopedKeys } from "../key-scope.ts";
import { documentFacts, readPdfInfo } from "./pdf-facts.ts";
import { PdfEngine } from "./pdf-engine.ts";
import { PdfFindBar } from "./PdfFindBar.tsx";
import { PdfPasswordPrompt, type PdfPasswordRequest } from "./PdfPasswordPrompt.tsx";
import { PdfPrintDialog } from "./PdfPrintDialog.tsx";
import { openFind, PdfStageBar } from "./PdfStageBar.tsx";
import { PdfThumbnails } from "./PdfThumbnails.tsx";
import type { PdfTools } from "./pdf-tools.ts";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

type ScrollKey = Parameters<PdfEngine["scrollFor"]>[0];

const SCROLL_KEYS: Readonly<Record<string, ScrollKey>> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

async function describeDocument(engine: PdfEngine, shell: InspectorShell, tools: PdfTools) {
	const [meta, outline] = await Promise.allSettled([
		engine.doc.getMetadata(),
		engine.readOutline(),
	]);
	shell.facts.value = documentFacts({
		info: readPdfInfo(meta.status === "fulfilled" ? meta.value.info : null),
		pageCount: engine.doc.numPages,
		knownPageCount: shell.asset.pageCount,
		firstPage: engine.firstPageSize(),
		formatDate: (date) => DATE_FORMAT.format(date),
	});
	tools.outline.value = outline.status === "fulfilled" ? outline.value : [];
}

/**
 * The PDF canvas: a continuous column of lazily rendered pages with selectable text, an optional
 * thumbnail rail, a floating page/zoom bar, find-in-document, an inline password form for
 * encrypted files, and the print dialog. pdf.js is loaded only here, in the mount effect.
 */
export function PdfStage({ shell, tools }: ViewerProps<PdfTools>): JSX.Element {
	const rootRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const pagesRef = useRef<HTMLDivElement>(null);
	const password = useSignal<PdfPasswordRequest | null>(null);
	warmPdfRuntime();

	// #region Document
	useEffect(() => {
		let disposed = false;
		let task: PDFDocumentLoadingTask | null = null;
		let engine: PdfEngine | null = null;

		const open = async () => {
			let runtime: PdfRuntime | null = null;
			try {
				runtime = await loadPdfRuntime();
				if (disposed) return;
				task = runtime.openPdf(shell.asset.src, (reason, submit) => {
					if (disposed) return;
					password.value = {
						reason,
						submit: (value) => {
							password.value = null;
							shell.status.value = "loading";
							submit(value);
						},
					};
					shell.status.value = "ready";
				});
				const doc = await task.promise;
				if (disposed) return;
				password.value = null;
				shell.status.value = "loading";
				const scroller = scrollerRef.current;
				const pages = pagesRef.current;
				if (!scroller || !pages) throw new Error("The PDF stage is not mounted.");
				const opened = await PdfEngine.create({ runtime, doc, scroller, pages, tools, shell });
				if (disposed) {
					opened.dispose();
					return;
				}
				engine = opened;
				tools.engine.value = opened;
				shell.status.value = "ready";
			} catch (error) {
				if (disposed || runtime?.isCancellation(error)) return;
				shell.fail(
					runtime
						? runtime.describeFailure(error)
						: "The PDF viewer couldn't load. Reload the page to try again.",
				);
				return;
			}
			if (engine) await describeDocument(engine, shell, tools);
		};
		void open();

		return () => {
			disposed = true;
			tools.engine.value = null;
			password.value = null;
			engine?.dispose();
			void task?.destroy();
		};
	}, []);
	// #endregion

	// #region Keys
	useEffect(() => {
		const stage = rootRef.current?.closest<HTMLElement>(".ins-stage") ?? null;
		if (!stage) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			if (isTypingTarget(event.target)) return;
			const engine = tools.engine.peek();
			if (!engine) return;
			const onStage = event.target === stage;
			switch (event.key) {
				case "PageDown":
					engine.stepPage(1);
					break;
				case "PageUp":
					engine.stepPage(-1);
					break;
				case "Home":
					engine.goToPage(1);
					break;
				case "End":
					engine.goToPage(tools.pageCount.peek());
					break;
				case "+":
				case "=":
					engine.stepZoom(1);
					break;
				case "-":
				case "_":
					engine.stepZoom(-1);
					break;
				case "0":
					tools.fit.value = "width";
					shell.announce("Fit to width");
					break;
				case "r":
				case "R":
					engine.rotate(event.shiftKey ? -1 : 1);
					break;
				case " ":
					if (!onStage) return;
					engine.scrollFor(event.shiftKey ? "screen-up" : "screen-down");
					break;
				default: {
					const scroll = SCROLL_KEYS[event.key];
					if (!scroll || !onStage) return;
					engine.scrollFor(scroll);
				}
			}
			event.preventDefault();
		};
		stage.addEventListener("keydown", onKey);
		return () => stage.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
			if (!tools.engine.peek()) return;
			const key = event.key.toLowerCase();
			if (key === "p" && shell.options.print) {
				event.preventDefault();
				tools.printOpen.value = true;
			} else if (key === "f") {
				event.preventDefault();
				openFind(tools);
			}
		};
		return listenScopedKeys(shell, rootRef.current, onKey, true);
	}, []);
	// #endregion

	const engine = tools.engine.value;
	const thumbnails = engine !== null && tools.thumbnails.value;
	const request = password.value;
	const { embedded, print } = shell.options;

	return (
		<div ref={rootRef} class="ins-pdf" data-thumbnails={thumbnails ? "true" : undefined}>
			{thumbnails && engine ? <PdfThumbnails tools={tools} engine={engine} /> : null}
			<div class="ins-pdf__view">
				<div ref={scrollerRef} class="ins-pdf__scroller">
					<div ref={pagesRef} class="ins-pdf__pages" />
				</div>
				{engine && tools.find.open.value ? <PdfFindBar tools={tools} /> : null}
				{engine && !embedded ? <PdfStageBar tools={tools} engine={engine} /> : null}
			</div>
			{request ? <PdfPasswordPrompt request={request} /> : null}
			{print ? <PdfPrintDialog shell={shell} tools={tools} /> : null}
		</div>
	);
}
