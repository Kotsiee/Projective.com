/// <reference lib="dom" />
import type { PageViewport, PDFPageProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfRuntime } from "../../../core/pdf-loader.ts";
import type { Size } from "../../../core/pdf-zoom.ts";
import type { PdfDest } from "./pdf-tools.ts";

/**
 * pdf-page-view — one page of the continuous PDF column: a sized shell that is always in the DOM,
 * and, while the page is near the viewport, its canvas, its selectable text layer and its links.
 * A re-render paints into a fresh canvas and swaps it in, so the stretched old pixels stay on screen
 * until the sharp ones are ready.
 */

type TextLayerInstance = InstanceType<PdfRuntime["TextLayer"]>;

/** One find highlight on a text item: characters `[from, to)`, `active` for the selected hit. */
export interface HighlightSpan {
	item: number;
	from: number;
	to: number;
	active: boolean;
}

/** What one render needs. */
export interface PageRenderRequest {
	proxy: PDFPageProxy;
	viewport: PageViewport;
	/** Device pixels per CSS pixel for the canvas backing store. */
	outputScale: number;
	/** Identifies the zoom/rotation/density this render is for. */
	key: string;
}

/** How a render ended. */
export type PageRenderOutcome = "done" | "cancelled" | "failed";

interface LinkAnnotation {
	rect: number[];
	url: string | null;
	dest: PdfDest | null;
}

function readLink(annotation: unknown): LinkAnnotation | null {
	if (typeof annotation !== "object" || annotation === null) return null;
	const a = annotation as Record<string, unknown>;
	if (a.subtype !== "Link" || !Array.isArray(a.rect) || a.rect.length !== 4) return null;
	const rect = a.rect.map(Number);
	if (rect.some((n) => !Number.isFinite(n))) return null;
	const url = typeof a.url === "string" && /^(https?:|mailto:)/i.test(a.url) ? a.url : null;
	const dest: PdfDest | null = typeof a.dest === "string" || Array.isArray(a.dest) ? a.dest : null;
	if (!url && dest === null) return null;
	return { rect, url, dest };
}

/** One page's DOM and its render state. */
export class PdfPageView {
	/** The always-present, always-sized page shell. */
	readonly el: HTMLDivElement;
	/** The key of the pixels on screen, or `null` when the page is blank. */
	renderedKey: string | null = null;
	/** The key that last failed to render, so it is not retried in a loop. */
	failedKey: string | null = null;

	private canvas: HTMLCanvasElement | null = null;
	private task: RenderTask | null = null;
	private textEl: HTMLDivElement | null = null;
	private textLayer: TextLayerInstance | null = null;
	private textReady = false;
	private linksEl: HTMLDivElement | null = null;
	private linksRotation: number | null = null;
	private highlighted = new Set<number>();

	constructor(
		readonly index: number,
		pageCount: number,
		private readonly runtime: PdfRuntime,
		private readonly onInternalLink: (dest: PdfDest) => void,
	) {
		const el = document.createElement("div");
		el.className = "ins-pdf-page";
		el.dataset.page = String(index + 1);
		el.setAttribute("role", "group");
		el.setAttribute("aria-label", `Page ${index + 1} of ${pageCount}`);
		this.el = el;
	}

	// #region Geometry
	/** Size the shell and give the text layer its scale. */
	setGeometry(size: Size, scaleFactor: number, userUnit: number): void {
		const { style } = this.el;
		style.setProperty("--ins-pdf-page-w", `${size.width}px`);
		style.setProperty("--ins-pdf-page-h", `${size.height}px`);
		style.setProperty("--scale-factor", String(scaleFactor));
		style.setProperty("--user-unit", String(userUnit));
	}
	// #endregion

	// #region Render
	/** Paint the page for `request`, replacing the current pixels only once the new ones are done. */
	async render(request: PageRenderRequest): Promise<PageRenderOutcome> {
		this.cancel();
		const { proxy, viewport, outputScale, key } = request;
		const canvas = document.createElement("canvas");
		canvas.className = "ins-pdf-page__canvas";
		canvas.setAttribute("aria-hidden", "true");
		canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
		canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
		const task = proxy.render({
			canvas,
			viewport,
			transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
		});
		this.task = task;
		try {
			await task.promise;
		} catch (error) {
			releaseCanvas(canvas);
			if (this.runtime.isCancellation(error)) return "cancelled";
			this.showFailure(key);
			return "failed";
		} finally {
			if (this.task === task) this.task = null;
		}
		if (this.canvas) {
			this.canvas.replaceWith(canvas);
			releaseCanvas(this.canvas);
		} else {
			this.el.prepend(canvas);
		}
		this.canvas = canvas;
		this.renderedKey = key;
		this.clearFailure();
		this.el.dataset.rendered = "true";
		return "done";
	}

	private showFailure(key: string): void {
		this.failedKey = key;
		if (this.el.querySelector(".ins-pdf-page__error")) return;
		const note = document.createElement("p");
		note.className = "ins-pdf-page__error";
		note.textContent = "This page couldn't be drawn.";
		this.el.append(note);
	}

	private clearFailure(): void {
		this.failedKey = null;
		this.el.querySelector(".ins-pdf-page__error")?.remove();
	}

	/**
	 * Build the selectable text layer once, or re-fit it to a new zoom or rotation. Resolves whether
	 * a layer was built; a page whose text cannot be read stays drawn, just not selectable.
	 */
	async ensureText(proxy: PDFPageProxy, viewport: PageViewport): Promise<boolean> {
		if (this.textLayer) {
			this.textLayer.update({ viewport });
			return false;
		}
		const el = document.createElement("div");
		el.className = "ins-pdf-text";
		if (this.linksEl) this.linksEl.before(el);
		else this.el.append(el);
		const layer = new this.runtime.TextLayer({
			textContentSource: proxy.streamTextContent({
				includeMarkedContent: true,
				disableNormalization: true,
			}),
			container: el,
			viewport,
		});
		this.textEl = el;
		this.textLayer = layer;
		this.textReady = false;
		try {
			await layer.render();
		} catch (error) {
			if (!this.runtime.isCancellation(error) && this.textLayer === layer) this.dropText();
			return false;
		}
		if (this.textLayer !== layer) return false;
		this.textReady = true;
		return true;
	}

	/** Lay the page's web and in-document links over it, as percentages of the page box. */
	async ensureLinks(proxy: PDFPageProxy, rotation: number): Promise<void> {
		if (this.linksRotation === rotation) return;
		this.linksRotation = rotation;
		let annotations: unknown[];
		try {
			annotations = await proxy.getAnnotations({ intent: "display" });
		} catch {
			if (this.linksRotation === rotation) this.linksRotation = null;
			return;
		}
		if (this.linksRotation !== rotation || !this.el.isConnected) return;
		const unit = proxy.getViewport({ scale: 1, rotation });
		const layer = document.createElement("div");
		layer.className = "ins-pdf-links";
		for (const annotation of annotations) {
			const link = readLink(annotation);
			if (!link) continue;
			const [x1, y1] = unit.convertToViewportPoint(link.rect[0], link.rect[1]).map(Number);
			const [x2, y2] = unit.convertToViewportPoint(link.rect[2], link.rect[3]).map(Number);
			const anchor = document.createElement("a");
			anchor.className = "ins-pdf-link";
			const { style } = anchor;
			style.setProperty("--ins-pdf-link-x", `${(Math.min(x1, x2) / unit.width) * 100}%`);
			style.setProperty("--ins-pdf-link-y", `${(Math.min(y1, y2) / unit.height) * 100}%`);
			style.setProperty("--ins-pdf-link-w", `${(Math.abs(x2 - x1) / unit.width) * 100}%`);
			style.setProperty("--ins-pdf-link-h", `${(Math.abs(y2 - y1) / unit.height) * 100}%`);
			if (link.url) {
				anchor.href = link.url;
				anchor.target = "_blank";
				anchor.rel = "noopener noreferrer";
				anchor.setAttribute("aria-label", `Open ${link.url} in a new tab`);
			} else if (link.dest !== null) {
				const dest = link.dest;
				anchor.href = "#";
				anchor.setAttribute("aria-label", "Go to the linked place in this document");
				anchor.addEventListener("click", (event) => {
					event.preventDefault();
					this.onInternalLink(dest);
				});
			}
			layer.append(anchor);
		}
		this.linksEl?.remove();
		this.linksEl = layer;
		this.el.append(layer);
	}

	/** Stop an in-flight render. */
	cancel(): void {
		this.task?.cancel();
		this.task = null;
	}

	/** Free the canvas, text layer and links; the sized shell stays. */
	release(): void {
		this.cancel();
		if (this.canvas) {
			releaseCanvas(this.canvas);
			this.canvas.remove();
			this.canvas = null;
		}
		this.dropText();
		this.linksEl?.remove();
		this.linksEl = null;
		this.linksRotation = null;
		this.renderedKey = null;
		this.clearFailure();
		delete this.el.dataset.rendered;
	}

	/** Whether anything is drawn (or being drawn) for this page. */
	get live(): boolean {
		return this.canvas !== null || this.textLayer !== null || this.task !== null;
	}

	private dropText(): void {
		this.textLayer?.cancel();
		this.textLayer = null;
		this.textReady = false;
		this.textEl?.remove();
		this.textEl = null;
		this.highlighted.clear();
	}
	// #endregion

	// #region Highlights
	/** Whether the text layer is built, so highlights can be drawn. */
	get hasText(): boolean {
		return this.textReady;
	}

	/** Mark find hits in the text layer; an empty list clears them. */
	highlight(spans: readonly HighlightSpan[]): void {
		const layer = this.textLayer;
		if (!layer || !this.textReady) return;
		const divs = layer.textDivs;
		const strings = layer.textContentItemsStr;
		for (const item of this.highlighted) {
			const div = divs[item];
			if (div) div.textContent = strings[item] ?? "";
		}
		this.highlighted.clear();
		const byItem = new Map<number, HighlightSpan[]>();
		for (const span of spans) {
			const list = byItem.get(span.item);
			if (list) list.push(span);
			else byItem.set(span.item, [span]);
		}
		for (const [item, list] of byItem) {
			const div = divs[item];
			const text = strings[item];
			if (!div || text === undefined) continue;
			list.sort((a, b) => a.from - b.from);
			const parts: Node[] = [];
			let cursor = 0;
			for (const span of list) {
				if (span.from > cursor) parts.push(document.createTextNode(text.slice(cursor, span.from)));
				const hit = document.createElement("span");
				hit.className = span.active ? "ins-pdf-hit ins-pdf-hit--active" : "ins-pdf-hit";
				hit.textContent = text.slice(span.from, span.to);
				parts.push(hit);
				cursor = Math.max(cursor, span.to);
			}
			if (cursor < text.length) parts.push(document.createTextNode(text.slice(cursor)));
			div.replaceChildren(...parts);
			this.highlighted.add(item);
		}
	}

	/** The selected hit's element, if it is on this page. */
	activeHit(): HTMLElement | null {
		return this.textEl?.querySelector<HTMLElement>(".ins-pdf-hit--active") ?? null;
	}
	// #endregion
}

/** Shrink a canvas's backing store so the browser can free it at once. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
	canvas.width = 0;
	canvas.height = 0;
}
