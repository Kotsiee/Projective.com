/// <reference lib="dom" />
import { batch, effect } from "@preact/signals";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfRuntime } from "../../../core/pdf-loader.ts";
import type { InspectorShell } from "../../../core/inspector-shell.ts";
import {
	anchorAt,
	anchorOffset,
	clampZoom,
	currentPage,
	fitZoom,
	layoutPages,
	PDF_CSS_UNITS,
	type PdfFit,
	type PdfLayout,
	type PdfPageBox,
	type PdfRotation,
	type PdfSpacing,
	rescaleScroll,
	rotateBy,
	stepZoom as nextZoomStop,
	totalRotation,
	visiblePages,
	wheelZoom,
	zoomPercent,
} from "../../../core/pdf-zoom.ts";
import {
	findInPage,
	type FindMatch,
	firstMatchFrom,
	indexPageText,
	matchSpans,
	normalizeQuery,
	type PageTextIndex,
	type PdfTextItem,
	stepMatch as nextMatch,
} from "./pdf-find.ts";
import { type HighlightSpan, PdfPageView, releaseCanvas } from "./pdf-page-view.ts";
import type { PdfDest, PdfOutlineItem, PdfTools } from "./pdf-tools.ts";

/**
 * pdf-engine — the imperative heart of the PDF canvas. It owns the page column inside the stage's
 * scroller: every page as a sized shell, with canvases, text layers and links only for the pages in
 * view (±1), released again once they scroll far away. It keeps the reader's place across zoom,
 * rotation and late-arriving page sizes, renders thumbnails on request, runs find-in-document, and
 * mirrors its state into {@link PdfTools} for the panel.
 */

// #region Tuning
const PREFETCH = 1;
const KEEP_AROUND = 3;
const MAX_CANVAS_PIXELS = 4096 * 4096;
const SETTLE_MS = 160;
const SEARCH_DEBOUNCE_MS = 180;
const SEARCH_PUBLISH_EVERY = 20;
const SIZE_RELAYOUT_EVERY = 25;
const ARROW_STEP_PX = 48;
const OUTLINE_LIMIT = 2000;
// #endregion

/** What the engine draws into and reports to. */
export interface PdfEngineHost {
	runtime: PdfRuntime;
	doc: PDFDocumentProxy;
	/** The scrolling viewport. */
	scroller: HTMLElement;
	/** The page column inside it; the engine owns its children. */
	pages: HTMLElement;
	tools: PdfTools;
	shell: InspectorShell;
}

interface Pinch {
	distance: number;
	zoom: number;
	target: number;
	clientX: number;
	clientY: number;
}

function boxOf(proxy: PDFPageProxy): PdfPageBox {
	const viewport = proxy.getViewport({ scale: 1, rotation: 0 });
	return { width: viewport.width, height: viewport.height, rotate: proxy.rotate };
}

function sameBox(a: PdfPageBox, b: PdfPageBox): boolean {
	return Math.abs(a.width - b.width) < 0.01 && Math.abs(a.height - b.height) < 0.01 &&
		a.rotate === b.rotate;
}

function isRef(value: unknown): value is { num: number; gen: number } {
	return typeof value === "object" && value !== null && "num" in value && "gen" in value &&
		typeof value.num === "number" && typeof value.gen === "number";
}

function px(value: string): number {
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? n : 0;
}

/** The live PDF canvas for one open document. */
export class PdfEngine {
	readonly doc: PDFDocumentProxy;
	private readonly runtime: PdfRuntime;
	private readonly scroller: HTMLElement;
	private readonly pages: HTMLElement;
	private readonly tools: PdfTools;
	private readonly shell: InspectorShell;
	private readonly count: number;
	private readonly boxes: PdfPageBox[];
	private readonly known: boolean[];
	private readonly userUnits: number[];
	private readonly proxies: (Promise<PDFPageProxy> | null)[];
	private readonly views: PdfPageView[];
	private readonly texts = new Map<number, Promise<PageTextIndex>>();
	private readonly cleanups: (() => void)[] = [];
	private layout: PdfLayout;
	private spacing: PdfSpacing = { gap: 0, padding: 0 };
	private measured = { width: 0, height: 0 };
	private shapes = 0;
	private publishedShapes = -1;
	private zoom = 1;
	private rotation: PdfRotation = 0;
	private pumping = false;
	private disposed = false;
	private settleTimer: ReturnType<typeof setTimeout> | null = null;
	private scrollFrame = 0;
	private highlightFrame = 0;
	private searchTimer: ReturnType<typeof setTimeout> | null = null;
	private searchGeneration = 0;
	private revealPending = -1;
	private matchesByPage = new Map<number, { match: FindMatch; index: number }[]>();
	private thumbChain: Promise<unknown> = Promise.resolve();
	private pinch: Pinch | null = null;

	private constructor(host: PdfEngineHost, first: PDFPageProxy) {
		this.runtime = host.runtime;
		this.doc = host.doc;
		this.scroller = host.scroller;
		this.pages = host.pages;
		this.tools = host.tools;
		this.shell = host.shell;
		this.count = host.doc.numPages;
		const firstBox = boxOf(first);
		this.boxes = Array.from({ length: this.count }, () => ({ ...firstBox }));
		this.known = Array.from({ length: this.count }, (_, i) => i === 0);
		this.userUnits = Array.from({ length: this.count }, () => first.userUnit);
		this.proxies = Array.from(
			{ length: this.count },
			(_, i) => i === 0 ? Promise.resolve(first) : null,
		);
		this.views = Array.from(
			{ length: this.count },
			(_, i) => new PdfPageView(i, this.count, this.runtime, (dest) => void this.goToDest(dest)),
		);
		this.layout = layoutPages(this.boxes, 0, 1, this.spacing);
	}

	/** Open the column for a loaded document and paint the first page in view. */
	static async create(host: PdfEngineHost): Promise<PdfEngine> {
		const first = await host.doc.getPage(1);
		const engine = new PdfEngine(host, first);
		try {
			await engine.start();
		} catch (error) {
			engine.dispose();
			throw error;
		}
		return engine;
	}

	// #region Lifecycle
	private async start(): Promise<void> {
		const { tools } = this;
		this.pages.replaceChildren(...this.views.map((v) => v.el));
		this.readSpacing();
		this.measured = { width: this.scroller.clientWidth, height: this.scroller.clientHeight };
		this.rotation = tools.rotation.peek();
		batch(() => {
			tools.pageCount.value = this.count;
			tools.page.value = 1;
		});
		this.zoom = this.fittedZoom(tools.fit.peek()) ?? clampZoom(tools.zoom.peek());
		tools.zoom.value = this.zoom;
		this.relayout();
		this.listen();
		const range = visiblePages(this.layout, 0, this.scroller.clientHeight);
		await this.renderPage(range ? range.first : 0);
		void this.pump();
		void this.measureRemaining();
	}

	/** Stop everything and free every canvas; the document itself is destroyed by its loading task. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		if (this.settleTimer !== null) clearTimeout(this.settleTimer);
		if (this.searchTimer !== null) clearTimeout(this.searchTimer);
		cancelAnimationFrame(this.scrollFrame);
		cancelAnimationFrame(this.highlightFrame);
		for (const view of this.views) view.release();
		this.pages.style.removeProperty("transform");
		this.pages.style.removeProperty("transform-origin");
		this.pages.replaceChildren();
	}

	private listen(): void {
		const { scroller, tools } = this;
		const onScroll = () => {
			if (this.scrollFrame) return;
			this.scrollFrame = requestAnimationFrame(() => {
				this.scrollFrame = 0;
				this.syncCurrentPage();
				if (this.settleTimer === null) void this.pump();
			});
		};
		scroller.addEventListener("scroll", onScroll, { passive: true });
		this.cleanups.push(() => scroller.removeEventListener("scroll", onScroll));

		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			const rect = scroller.getBoundingClientRect();
			this.setZoom(wheelZoom(this.zoom, event.deltaY, event.deltaMode), {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			});
		};
		scroller.addEventListener("wheel", onWheel, { passive: false });
		this.cleanups.push(() => scroller.removeEventListener("wheel", onWheel));

		this.listenPinch();

		const resize = new ResizeObserver(() => this.onResize());
		resize.observe(scroller);
		this.cleanups.push(() => resize.disconnect());

		this.cleanups.push(effect(() => {
			const fit = tools.fit.value;
			if (fit !== "custom") this.applyFit(fit);
		}));
		this.cleanups.push(effect(() => {
			const rotation = tools.rotation.value;
			if (rotation !== this.rotation) this.applyRotation(rotation);
		}));
		this.cleanups.push(effect(() => {
			const query = tools.find.query.value;
			const open = tools.find.open.value;
			this.onQuery(open ? query : "");
		}));
		this.cleanups.push(effect(() => {
			this.indexMatches(tools.find.matches.value);
			this.queueHighlights();
		}));
		this.cleanups.push(effect(() => {
			const active = tools.find.active.value;
			this.queueHighlights();
			if (active >= 0) this.reveal(active);
		}));
	}
	// #endregion

	// #region Layout
	private readSpacing(): void {
		const style = getComputedStyle(this.pages);
		this.spacing = { gap: px(style.rowGap), padding: px(style.paddingBlockStart) };
	}

	private viewportSize(): { width: number; height: number } {
		return { width: this.scroller.clientWidth, height: this.scroller.clientHeight };
	}

	private relayout(): void {
		this.layout = layoutPages(this.boxes, this.rotation, this.zoom, this.spacing);
		const scale = this.zoom * PDF_CSS_UNITS;
		this.layout.sizes.forEach((size, i) => {
			this.views[i].setGeometry(size, scale, this.userUnits[i]);
		});
		if (this.shapes !== this.publishedShapes) {
			this.publishedShapes = this.shapes;
			this.tools.layoutVersion.value = this.tools.layoutVersion.peek() + 1;
		}
	}

	private relayoutKeepingPlace(pointerY = 0): void {
		const anchor = anchorAt(this.layout, this.scroller.scrollTop + pointerY);
		this.relayout();
		this.scroller.scrollTop = anchorOffset(this.layout, anchor) - pointerY;
	}

	private syncCurrentPage(): void {
		const index = currentPage(this.layout, this.scroller.scrollTop, this.scroller.clientHeight);
		if (this.tools.page.peek() !== index + 1) this.tools.page.value = index + 1;
	}

	private onResize(): void {
		if (this.disposed) return;
		const { clientWidth, clientHeight } = this.scroller;
		if (clientWidth === this.measured.width && clientHeight === this.measured.height) return;
		this.measured = { width: clientWidth, height: clientHeight };
		this.readSpacing();
		const fit = this.tools.fit.peek();
		if (fit === "width" || fit === "page") this.applyFit(fit);
		else this.relayoutKeepingPlace();
		this.scheduleSettle();
	}

	private currentBox(): PdfPageBox {
		const index = Math.min(this.count - 1, Math.max(0, this.tools.page.peek() - 1));
		return this.boxes[index];
	}

	private fittedZoom(fit: PdfFit): number | null {
		if (fit === "actual") return 1;
		if (fit === "custom") return null;
		return fitZoom(fit, this.currentBox(), this.rotation, this.viewportSize(), this.spacing);
	}

	private applyFit(fit: PdfFit): void {
		const zoom = this.fittedZoom(fit);
		if (zoom === null) return;
		this.changeZoom(zoom, null);
	}

	private changeZoom(zoom: number, pointer: { x: number; y: number } | null): void {
		const next = clampZoom(zoom);
		if (Math.abs(next - this.zoom) < 1e-4) return;
		const { scroller } = this;
		const oldWidth = Math.max(this.layout.width, scroller.clientWidth);
		const x = pointer?.x ?? scroller.clientWidth / 2;
		const y = pointer?.y ?? 0;
		const left = scroller.scrollLeft;
		this.zoom = next;
		this.tools.zoom.value = next;
		for (const view of this.views) view.cancel();
		this.relayoutKeepingPlace(y);
		const newWidth = Math.max(this.layout.width, scroller.clientWidth);
		scroller.scrollLeft = rescaleScroll(left, x, oldWidth, newWidth);
		this.scheduleSettle();
	}

	private scheduleSettle(): void {
		if (this.settleTimer !== null) clearTimeout(this.settleTimer);
		this.settleTimer = setTimeout(() => {
			this.settleTimer = null;
			this.syncCurrentPage();
			void this.pump();
		}, SETTLE_MS);
	}

	private applyRotation(rotation: PdfRotation): void {
		this.shapes++;
		this.rotation = rotation;
		for (const view of this.views) view.release();
		const fit = this.tools.fit.peek();
		const fitted = this.fittedZoom(fit);
		if (fitted !== null) {
			this.zoom = fitted;
			this.tools.zoom.value = fitted;
		}
		this.relayoutKeepingPlace();
		this.scheduleSettle();
	}

	private async measureRemaining(): Promise<void> {
		let dirty = false;
		for (let i = 1; i < this.count; i++) {
			if (this.disposed) return;
			if (!this.known[i]) {
				const proxy = await this.pageProxy(i);
				if (this.disposed) return;
				dirty = this.learn(i, proxy) || dirty;
			}
			if (dirty && (i % SIZE_RELAYOUT_EVERY === 0 || i === this.count - 1)) {
				dirty = false;
				this.relayoutKeepingPlace();
				if (this.settleTimer === null) void this.pump();
			}
		}
	}

	private learn(index: number, proxy: PDFPageProxy): boolean {
		this.known[index] = true;
		this.userUnits[index] = proxy.userUnit;
		const box = boxOf(proxy);
		if (sameBox(box, this.boxes[index])) return false;
		this.boxes[index] = box;
		this.shapes++;
		return true;
	}

	private pageProxy(index: number): Promise<PDFPageProxy> {
		const cached = this.proxies[index];
		if (cached) return cached;
		const pending = this.doc.getPage(index + 1);
		this.proxies[index] = pending;
		pending.catch(() => {
			if (this.proxies[index] === pending) this.proxies[index] = null;
		});
		return pending;
	}
	// #endregion

	// #region Rendering
	private renderKey(): string {
		return `${this.zoom.toFixed(4)}|${this.rotation}|${globalThis.devicePixelRatio || 1}`;
	}

	private nextTarget(): number | null {
		const range = visiblePages(this.layout, this.scroller.scrollTop, this.scroller.clientHeight);
		if (!range) return null;
		const current = this.tools.page.peek() - 1;
		const order: number[] = [];
		for (let i = range.first; i <= range.last; i++) order.push(i);
		order.sort((a, b) => Math.abs(a - current) - Math.abs(b - current));
		for (let step = 1; step <= PREFETCH; step++) {
			if (range.last + step < this.count) order.push(range.last + step);
			if (range.first - step >= 0) order.push(range.first - step);
		}
		const key = this.renderKey();
		for (const i of order) {
			const view = this.views[i];
			if (view.renderedKey !== key && view.failedKey !== key) return i;
		}
		return null;
	}

	private async pump(): Promise<void> {
		if (this.pumping || this.disposed) return;
		this.pumping = true;
		try {
			while (!this.disposed && this.settleTimer === null && this.pinch === null) {
				const target = this.nextTarget();
				if (target === null) break;
				await this.renderPage(target);
			}
			if (!this.disposed) this.releaseFar();
		} finally {
			this.pumping = false;
		}
	}

	private outputScale(width: number, height: number): number {
		const density = globalThis.devicePixelRatio || 1;
		const area = width * height;
		if (area <= 0) return density;
		return Math.min(density, Math.sqrt(MAX_CANVAS_PIXELS / area));
	}

	private async renderPage(index: number): Promise<void> {
		let proxy: PDFPageProxy;
		try {
			proxy = await this.pageProxy(index);
		} catch (error) {
			if (this.runtime.isCancellation(error) || this.disposed) return;
			this.views[index].failedKey = this.renderKey();
			return;
		}
		if (this.disposed) return;
		if (this.learn(index, proxy)) this.relayoutKeepingPlace();
		const view = this.views[index];
		const rotation = totalRotation(this.boxes[index], this.rotation);
		const viewport = proxy.getViewport({ scale: this.zoom * PDF_CSS_UNITS, rotation });
		const key = this.renderKey();
		const outcome = await view.render({
			proxy,
			viewport,
			outputScale: this.outputScale(viewport.width, viewport.height),
			key,
		});
		if (outcome !== "done" || this.disposed) return;
		void view.ensureLinks(proxy, rotation);
		await view.ensureText(proxy, viewport);
		if (this.disposed || !view.hasText) return;
		this.paintHighlights(view);
	}

	private releaseFar(): void {
		const range = visiblePages(this.layout, this.scroller.scrollTop, this.scroller.clientHeight);
		if (!range) return;
		const from = range.first - KEEP_AROUND;
		const to = range.last + KEEP_AROUND;
		this.views.forEach((view, i) => {
			if ((i < from || i > to) && view.live) {
				view.release();
				void this.proxies[i]?.then((proxy) => proxy.cleanup(), () => false);
			}
		});
	}
	// #endregion

	// #region Navigation
	/** Scroll to a page (1-based); `announce` speaks the new position. */
	goToPage(page: number, announce = true, offset = 0): void {
		if (this.count === 0) return;
		const index = Math.min(this.count - 1, Math.max(0, Math.round(page) - 1));
		this.scroller.scrollTop = this.layout.tops[index] - this.spacing.padding + offset;
		this.tools.page.value = index + 1;
		if (announce) this.shell.announce(`Page ${index + 1} of ${this.count}`);
		if (this.settleTimer === null) void this.pump();
	}

	/** Step one page forward (`1`) or back (`-1`). */
	stepPage(direction: 1 | -1): void {
		this.goToPage(this.tools.page.peek() + direction);
	}

	/** Follow an outline entry or an in-document link. */
	async goToDest(dest: PdfDest): Promise<void> {
		let explicit: readonly unknown[] | null = null;
		try {
			explicit = typeof dest === "string" ? await this.doc.getDestination(dest) : dest;
		} catch (error) {
			if (this.runtime.isCancellation(error)) return;
			this.shell.announce("That link points to a place this document doesn't have.");
			return;
		}
		if (!explicit || explicit.length === 0 || this.disposed) return;
		const [target, kind, ...args] = explicit;
		let index: number;
		try {
			if (isRef(target)) index = await this.doc.getPageIndex(target);
			else if (typeof target === "number" && Number.isInteger(target)) index = target;
			else return;
		} catch (error) {
			if (this.runtime.isCancellation(error)) return;
			this.shell.announce("That link points to a place this document doesn't have.");
			return;
		}
		if (this.disposed || index < 0 || index >= this.count) return;
		const name = typeof kind === "object" && kind !== null && "name" in kind ? kind.name : null;
		let left: number | null = null;
		let top: number | null = null;
		if (name === "XYZ") {
			left = typeof args[0] === "number" ? args[0] : null;
			top = typeof args[1] === "number" ? args[1] : null;
		} else if (name === "FitH" || name === "FitBH") {
			top = typeof args[0] === "number" ? args[0] : null;
		}
		let offset = 0;
		if (top !== null) {
			const proxy = await this.pageProxy(index);
			if (this.disposed) return;
			const viewport = proxy.getViewport({
				scale: this.zoom * PDF_CSS_UNITS,
				rotation: totalRotation(this.boxes[index], this.rotation),
			});
			const [, y] = viewport.convertToViewportPoint(left ?? 0, top);
			offset = Math.max(0, y) + this.spacing.padding;
		}
		this.goToPage(index + 1, true, offset);
	}
	// #endregion

	// #region Zoom & rotation
	/** Set the zoom, keeping the content under `pointer` (viewport px) in place; the fit becomes custom. */
	setZoom(zoom: number, pointer: { x: number; y: number } | null = null): void {
		this.tools.fit.value = "custom";
		this.changeZoom(zoom, pointer);
	}

	/** Step the zoom to the next stop and announce it. */
	stepZoom(direction: 1 | -1): void {
		this.setZoom(nextZoomStop(this.zoom, direction));
		this.shell.announce(`Zoom ${zoomPercent(this.zoom)}`);
	}

	/** Turn every page a quarter clockwise (`1`) or counter-clockwise (`-1`). */
	rotate(direction: 1 | -1): void {
		const next = rotateBy(this.tools.rotation.peek(), direction);
		this.tools.rotation.value = next;
		this.shell.announce(`Rotated to ${next}°`);
	}

	/**
	 * Scroll for a key pressed on the stage itself (where the browser would not scroll the inner
	 * column): arrows move a line, Space a screen.
	 */
	scrollFor(key: "up" | "down" | "left" | "right" | "screen-up" | "screen-down"): void {
		const screen = Math.max(ARROW_STEP_PX, this.scroller.clientHeight - ARROW_STEP_PX);
		const steps: Record<typeof key, [number, number]> = {
			up: [0, -ARROW_STEP_PX],
			down: [0, ARROW_STEP_PX],
			left: [-ARROW_STEP_PX, 0],
			right: [ARROW_STEP_PX, 0],
			"screen-up": [0, -screen],
			"screen-down": [0, screen],
		};
		const [left, top] = steps[key];
		this.scroller.scrollBy({ left, top });
	}

	private listenPinch(): void {
		const { scroller, pages } = this;
		const spread = (touches: TouchList) =>
			Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
		const onStart = (event: TouchEvent) => {
			if (event.touches.length !== 2) return;
			const distance = spread(event.touches);
			if (distance <= 0) return;
			const clientX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
			const clientY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
			const rect = pages.getBoundingClientRect();
			pages.style.transformOrigin = `${clientX - rect.left}px ${clientY - rect.top}px`;
			this.pinch = { distance, zoom: this.zoom, target: this.zoom, clientX, clientY };
		};
		const onMove = (event: TouchEvent) => {
			const pinch = this.pinch;
			if (!pinch || event.touches.length !== 2) return;
			event.preventDefault();
			pinch.target = clampZoom(pinch.zoom * (spread(event.touches) / pinch.distance));
			pages.style.transform = `scale(${pinch.target / pinch.zoom})`;
		};
		const onEnd = (event: TouchEvent) => {
			const pinch = this.pinch;
			if (!pinch || event.touches.length >= 2) return;
			this.pinch = null;
			pages.style.removeProperty("transform");
			pages.style.removeProperty("transform-origin");
			const rect = scroller.getBoundingClientRect();
			this.setZoom(pinch.target, { x: pinch.clientX - rect.left, y: pinch.clientY - rect.top });
		};
		scroller.addEventListener("touchstart", onStart, { passive: true });
		scroller.addEventListener("touchmove", onMove, { passive: false });
		scroller.addEventListener("touchend", onEnd, { passive: true });
		scroller.addEventListener("touchcancel", onEnd, { passive: true });
		this.cleanups.push(() => {
			scroller.removeEventListener("touchstart", onStart);
			scroller.removeEventListener("touchmove", onMove);
			scroller.removeEventListener("touchend", onEnd);
			scroller.removeEventListener("touchcancel", onEnd);
		});
	}
	// #endregion

	// #region Find
	/** Select the next (`1`) or previous (`-1`) match. */
	stepMatch(direction: 1 | -1): void {
		const { find } = this.tools;
		const next = nextMatch(find.active.peek(), find.matches.peek().length, direction);
		if (next === find.active.peek() && next >= 0) this.reveal(next);
		else find.active.value = next;
	}

	private onQuery(query: string): void {
		const { find } = this.tools;
		this.searchGeneration++;
		if (this.searchTimer !== null) clearTimeout(this.searchTimer);
		this.searchTimer = null;
		this.revealPending = -1;
		if (normalizeQuery(query).length === 0) {
			batch(() => {
				find.matches.value = [];
				find.active.value = -1;
				find.searching.value = false;
			});
			return;
		}
		find.searching.value = true;
		const generation = this.searchGeneration;
		this.searchTimer = setTimeout(() => {
			this.searchTimer = null;
			void this.search(generation, query);
		}, SEARCH_DEBOUNCE_MS);
	}

	private pageText(index: number): Promise<PageTextIndex> {
		const cached = this.texts.get(index);
		if (cached) return cached;
		const pending = this.pageProxy(index)
			.then((proxy) => proxy.getTextContent({ disableNormalization: true }))
			.then((content) => {
				const items: PdfTextItem[] = [];
				for (const item of content.items) if ("str" in item) items.push(item);
				return indexPageText(items);
			});
		this.texts.set(index, pending);
		pending.catch(() => this.texts.delete(index));
		return pending;
	}

	private async search(generation: number, query: string): Promise<void> {
		const { find } = this.tools;
		const found: FindMatch[] = [];
		const start = this.tools.page.peek() - 1;
		let chosen = -1;
		let unread = 0;
		const stale = () => this.disposed || generation !== this.searchGeneration;
		const publish = () => {
			batch(() => {
				find.matches.value = [...found];
				if (chosen >= 0 && find.active.peek() < 0) find.active.value = chosen;
			});
		};
		batch(() => {
			find.matches.value = [];
			find.active.value = -1;
		});
		for (let i = 0; i < this.count; i++) {
			let index: PageTextIndex;
			try {
				index = await this.pageText(i);
			} catch (error) {
				if (stale()) return;
				if (!this.runtime.isCancellation(error)) unread++;
				continue;
			}
			if (stale()) return;
			const hits = findInPage(index, query, i);
			if (hits.length > 0) {
				if (chosen < 0 && i >= start) chosen = found.length;
				found.push(...hits);
				publish();
			} else if (i % SEARCH_PUBLISH_EVERY === 0) {
				publish();
			}
		}
		if (stale()) return;
		if (chosen < 0) chosen = firstMatchFrom(found, start);
		publish();
		find.searching.value = false;
		const total = found.length;
		const note = unread > 0
			? ` ${unread} ${unread === 1 ? "page" : "pages"} couldn't be searched.`
			: "";
		this.shell.announce(
			total === 0 ? `No matches.${note}` : `${total} ${total === 1 ? "match" : "matches"}.${note}`,
		);
	}

	private indexMatches(matches: readonly FindMatch[]): void {
		const byPage = new Map<number, { match: FindMatch; index: number }[]>();
		matches.forEach((match, index) => {
			const list = byPage.get(match.page);
			if (list) list.push({ match, index });
			else byPage.set(match.page, [{ match, index }]);
		});
		this.matchesByPage = byPage;
	}

	private queueHighlights(): void {
		if (this.highlightFrame) return;
		this.highlightFrame = requestAnimationFrame(() => {
			this.highlightFrame = 0;
			for (const view of this.views) if (view.hasText) this.paintHighlights(view);
		});
	}

	private paintHighlights(view: PdfPageView): void {
		const hits = this.matchesByPage.get(view.index);
		if (!hits || hits.length === 0) {
			view.highlight([]);
			return;
		}
		const indexPromise = this.texts.get(view.index);
		if (!indexPromise) return;
		const active = this.tools.find.active.peek();
		void indexPromise.then((index) => {
			if (this.disposed || !view.hasText) return;
			const spans: HighlightSpan[] = [];
			for (const { match, index: n } of hits) {
				for (const span of matchSpans(index, match.start, match.end)) {
					spans.push({ ...span, active: n === active });
				}
			}
			view.highlight(spans);
			if (
				this.revealPending >= 0 &&
				this.tools.find.matches.peek()[this.revealPending]?.page === view.index
			) {
				this.scrollToHit(view);
			}
		}, () => view.highlight([]));
	}

	private reveal(active: number): void {
		const match = this.tools.find.matches.peek()[active];
		if (!match) return;
		this.revealPending = active;
		const range = visiblePages(this.layout, this.scroller.scrollTop, this.scroller.clientHeight);
		const view = this.views[match.page];
		if (!range || match.page < range.first || match.page > range.last || !view.hasText) {
			this.goToPage(match.page + 1, false);
		}
		if (view.hasText) this.paintHighlights(view);
	}

	private scrollToHit(view: PdfPageView): void {
		const hit = view.activeHit();
		if (!hit) return;
		this.revealPending = -1;
		const box = this.scroller.getBoundingClientRect();
		const rect = hit.getBoundingClientRect();
		const outsideY = rect.top < box.top || rect.bottom > box.bottom;
		const outsideX = rect.left < box.left || rect.right > box.right;
		if (outsideY) this.scroller.scrollTop += rect.top - box.top - this.scroller.clientHeight / 3;
		if (outsideX) {
			this.scroller.scrollLeft += rect.left - box.left - this.scroller.clientWidth / 3;
		}
	}
	// #endregion

	// #region Thumbnails & document
	/** The page's width-over-height as drawn now. */
	pageRatio(index: number): number {
		const size = this.layout.sizes[index];
		return size && size.height > 0 ? size.width / size.height : 1;
	}

	/**
	 * Draw a page `width` CSS px wide into a new canvas. Thumbnails render one at a time so they never
	 * crowd out the main pages; `null` when the page could not be drawn or the engine has closed.
	 */
	renderThumbnail(index: number, width: number): Promise<HTMLCanvasElement | null> {
		const job = this.thumbChain.then(async () => {
			if (this.disposed) return null;
			const proxy = await this.pageProxy(index);
			if (this.disposed) return null;
			const rotation = totalRotation(this.boxes[index], this.rotation);
			const unit = proxy.getViewport({ scale: 1, rotation });
			const viewport = proxy.getViewport({ scale: width / unit.width, rotation });
			const density = globalThis.devicePixelRatio || 1;
			const canvas = document.createElement("canvas");
			canvas.className = "ins-pdf-thumb__canvas";
			canvas.setAttribute("aria-hidden", "true");
			canvas.width = Math.max(1, Math.floor(viewport.width * density));
			canvas.height = Math.max(1, Math.floor(viewport.height * density));
			try {
				await proxy.render({
					canvas,
					viewport,
					transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0],
				}).promise;
			} catch (error) {
				releaseCanvas(canvas);
				if (this.runtime.isCancellation(error)) return null;
				throw error;
			}
			return canvas;
		});
		const settled = job.catch(() => null);
		this.thumbChain = settled;
		return settled;
	}

	/** The outline (bookmarks) flattened into keyed entries, capped for very large outlines. */
	async readOutline(): Promise<PdfOutlineItem[]> {
		const outline = await this.doc.getOutline();
		let budget = OUTLINE_LIMIT;
		const map = (nodes: readonly unknown[], prefix: string): PdfOutlineItem[] => {
			const items: PdfOutlineItem[] = [];
			nodes.forEach((node, i) => {
				if (budget <= 0 || typeof node !== "object" || node === null) return;
				budget--;
				const n = node as Record<string, unknown>;
				const title = typeof n.title === "string" ? n.title.trim() : "";
				const dest = typeof n.dest === "string" || Array.isArray(n.dest) ? n.dest : null;
				const url = typeof n.url === "string" && /^(https?:|mailto:)/i.test(n.url) ? n.url : null;
				const key = `${prefix}${i}`;
				const children = Array.isArray(n.items) ? map(n.items, `${key}.`) : [];
				if (title.length === 0 && children.length === 0) return;
				items.push({ key, title: title || "Untitled", dest, url, items: children });
			});
			return items;
		};
		return Array.isArray(outline) ? map(outline, "") : [];
	}

	/** The first page's size in points, as drawn upright. */
	firstPageSize(): { width: number; height: number } | null {
		const box = this.boxes[0];
		if (!box) return null;
		return box.rotate % 180 === 0
			? { width: box.width, height: box.height }
			: { width: box.height, height: box.width };
	}
	// #endregion
}
