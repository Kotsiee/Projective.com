import type { JSX } from "preact";
import { batch, effect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { loadDocx } from "../../../core/docx-loader.ts";
import type { ParsedDocx } from "../../../core/docx-runtime.ts";
import type { ViewerProps } from "../viewer.ts";
import { listenScopedKeys } from "../key-scope.ts";
import { DocxPrinter } from "./docx-print.ts";
import type { DocxTools } from "./docx-tools.ts";
import { clampDocxZoom, docxFacts, fitDocxZoom } from "./docx-model.ts";
import { plainKey, scrollForKey, useStageKeys } from "./stage-keys.ts";

/** Largest .docx the canvas reads into the page. */
const DOCX_PREVIEW_MAX_BYTES = 50_000_000;
const PT_TO_PX = 96 / 72;
const WHEEL_LINE_PX = 16;

// #region Load
class DocxLoadError extends Error {
	constructor(readonly reason: string, options?: ErrorOptions) {
		super(reason, options);
		this.name = "DocxLoadError";
	}
}

async function fetchDocx(src: string, signal: AbortSignal): Promise<Blob> {
	const response = await fetch(src, { signal, credentials: "same-origin" });
	if (!response.ok) {
		await response.body?.cancel();
		throw new DocxLoadError(
			response.status === 404
				? "This document isn't available any more."
				: "This document couldn't be loaded.",
		);
	}
	return await response.blob();
}

async function openDocx(src: string, signal: AbortSignal): Promise<ParsedDocx> {
	const [runtime, blob] = await Promise.all([
		loadDocx().catch((error: unknown) => {
			throw new DocxLoadError(
				"The document viewer couldn't load. Reload the page to try again.",
				{ cause: error },
			);
		}),
		fetchDocx(src, signal),
	]);
	try {
		return await runtime.parseDocx(blob);
	} catch (error) {
		throw new DocxLoadError(
			"This document couldn't be read. It may be damaged, protected, or not a Word document.",
			{ cause: error },
		);
	}
}
// #endregion

// #region Measure
function naturalPageWidth(pages: readonly HTMLElement[], zoom: number): number {
	let widest = 0;
	for (const page of pages) {
		const declared = page.style.width.endsWith("pt")
			? Number.parseFloat(page.style.width) * PT_TO_PX
			: Number.NaN;
		const width = Number.isFinite(declared) ? declared : page.getBoundingClientRect().width / zoom;
		widest = Math.max(widest, width);
	}
	return widest;
}

function inlinePadding(el: Element | null): number {
	if (!el) return 0;
	const style = getComputedStyle(el);
	return Number.parseFloat(style.paddingInlineStart) + Number.parseFloat(style.paddingInlineEnd);
}

function wheelPixels(event: WheelEvent, page: number): number {
	if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * WHEEL_LINE_PX;
	if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * page;
	return event.deltaY;
}
// #endregion

/** The Word canvas: docx-preview pages on a scrolling desk, zoomed with a CSS variable. */
export function DocxStage({ shell, tools }: ViewerProps<DocxTools>): JSX.Element {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const stylesRef = useRef<HTMLDivElement>(null);
	const pagesRef = useRef<HTMLDivElement>(null);
	const pageWidth = useRef(0);

	const refit = () => {
		const mode = tools.mode.peek();
		const scroller = scrollerRef.current;
		const pages = pagesRef.current;
		if (mode === "manual" || !scroller || !pages || pageWidth.current <= 0) return;
		const available = scroller.clientWidth - inlinePadding(pages.querySelector(".docx-wrapper"));
		tools.zoom.value = fitDocxZoom(available, pageWidth.current, mode);
	};

	// #region Fetch and parse
	useEffect(() => {
		const { asset } = shell;
		if (asset.sizeBytes > DOCX_PREVIEW_MAX_BYTES) {
			shell.fail("This document is too large to preview here. Download it to open it.");
			return;
		}
		const abort = new AbortController();
		openDocx(asset.src, abort.signal)
			.then((doc) => {
				if (abort.signal.aborted) return;
				batch(() => {
					shell.facts.value = docxFacts(doc.properties, asset.pageCount);
					tools.headersFooters.value = doc.features.headersFooters;
					tools.notes.value = doc.features.notes;
					tools.document.value = doc;
				});
			})
			.catch((error: unknown) => {
				if (abort.signal.aborted) return;
				shell.fail(
					error instanceof DocxLoadError ? error.reason : "This document couldn't be loaded.",
				);
			});
		return () => abort.abort();
	}, [shell, tools]);
	// #endregion

	// #region Render
	useEffect(() => {
		const body = pagesRef.current;
		const styles = stylesRef.current;
		if (!body || !styles) return;
		let alive = true;
		let generation = 0;
		const stop = effect(() => {
			const doc = tools.document.value;
			const switches = {
				breakPages: tools.breakPages.value,
				headersFooters: tools.headersFooters.value,
				notes: tools.notes.value,
				changes: tools.changes.value,
			};
			if (!doc) return;
			const run = ++generation;
			body.setAttribute("aria-busy", "true");
			doc.render(body, styles, switches)
				.then(() => {
					if (!alive || run !== generation) return;
					body.removeAttribute("aria-busy");
					const pages = Array.from(
						body.querySelectorAll<HTMLElement>(".docx-wrapper > section"),
					);
					tools.pageCount.value = pages.length;
					pageWidth.current = naturalPageWidth(pages, tools.zoom.peek());
					refit();
					if (shell.status.peek() === "loading") shell.status.value = "ready";
				})
				.catch(() => {
					if (alive && run === generation) shell.fail("This document couldn't be drawn.");
				});
		});
		return () => {
			alive = false;
			stop();
		};
	}, [shell, tools]);
	// #endregion

	// #region Zoom
	useEffect(() => {
		const scroller = scrollerRef.current;
		const pages = pagesRef.current;
		if (!scroller || !pages) return;
		const stopZoom = effect(() => {
			const zoom = tools.zoom.value;
			const ratio = scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0;
			pages.style.setProperty("--ins-docx-zoom", String(zoom));
			scroller.scrollTop = ratio * scroller.scrollHeight;
		});
		const stopMode = effect(() => {
			if (tools.mode.value !== "manual") refit();
		});
		const resize = new ResizeObserver(() => refit());
		resize.observe(scroller);
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			const delta = wheelPixels(event, scroller.clientHeight);
			tools.zoomTo(clampDocxZoom(tools.zoom.peek() * Math.exp(-delta * 0.002)));
		};
		scroller.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			stopZoom();
			stopMode();
			resize.disconnect();
			scroller.removeEventListener("wheel", onWheel);
		};
	}, [tools]);
	// #endregion

	// #region Print
	useEffect(() => {
		const pages = pagesRef.current;
		if (!pages || !shell.options.print) return;
		const printer = new DocxPrinter(pages);
		tools.printer = printer;
		const detach = printer.attach();
		const onKey = (event: KeyboardEvent) => {
			const mod = event.ctrlKey || event.metaKey;
			if (!mod || event.altKey || event.shiftKey || event.key.toLowerCase() !== "p") return;
			if (shell.status.peek() !== "ready") return;
			event.preventDefault();
			tools.print();
		};
		const release = listenScopedKeys(shell, pages, onKey);
		return () => {
			release();
			detach();
			if (tools.printer === printer) tools.printer = null;
		};
	}, [shell, tools]);
	// #endregion

	useStageKeys(scrollerRef, (event, stage) => {
		if (plainKey(event)) {
			switch (event.key) {
				case "+":
				case "=":
					tools.zoomBy(1);
					return true;
				case "-":
				case "_":
					tools.zoomBy(-1);
					return true;
				case "0":
					tools.fitWidth();
					return true;
				case "1":
					tools.actualSize();
					return true;
			}
		}
		const scroller = scrollerRef.current;
		return scroller ? scrollForKey(event, stage, scroller) : false;
	});

	return (
		<div class="ins-docx" ref={scrollerRef}>
			<div class="ins-docx__styles" ref={stylesRef} hidden />
			<div class="ins-docx__pages" ref={pagesRef} />
		</div>
	);
}
