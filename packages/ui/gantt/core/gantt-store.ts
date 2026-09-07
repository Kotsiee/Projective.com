/**
 * @projective/ui/gantt — the VIEWPORT STORE: every number the timeline's geometry is a function of,
 * held as `@preact/signals` so a pan, a zoom or a hover moves the canvas without a VDOM render
 * (SYSTEM_ARCHITECTURE.md §Charts "Signal-Driven" — the `GanttStore` that document names).
 *
 * It owns the offsets outright. There is no scroll container anywhere in this engine — the canvas
 * fills a clipped box and the DOM header and task list translate to match — so every behaviour a
 * native scroller quietly provides (clamping, wheel units, a programmatic jump that is visible in the
 * same tick) is re-implemented here or is simply gone. The upside is the one the calendar's canvas
 * viewport already paid for: a write to `scrollX` is visible to everything downstream synchronously,
 * with no `scroll` event to wait for and nothing to re-sync in a hidden tab.
 *
 * THE ZOOM ANCHOR. A zoom re-pins the offset so the axis scales IN PLACE, and which instant is held
 * still is a choice: the viewport centre by default, or — once {@link GanttStore.setZoomAnchor} has
 * been told where the pointer is — the instant under the cursor. The anchored instant is captured
 * ONCE and re-solved from in closed form on every subsequent step, so a wheel burst holds the same
 * moment under the cursor on every notch instead of walking it a fraction at a time.
 *
 * DOM-free and clock-free, which is what makes it testable: the hook layer (`useGanttViewport`)
 * feeds it measurements and gestures, and the springs that decorate a journey live there too.
 */
import { batch, computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import type { RowGeometry } from "./layout.ts";
import { contentHeight } from "./layout.ts";
import {
	AXIS_LIMIT_DAYS,
	clampZoom,
	fitZoom,
	msAtX,
	PX_PER_DAY_DEFAULT,
	tierFor,
	type TimeTier,
	xOfMs,
	ZOOM_RANGE_DEFAULT,
	zoomedScrollX,
} from "./time-scale.ts";
import type { GanttRange } from "./types.ts";

// #region Constants
/** The base row height (px) before the palette has been read — replaced by the token on first draw. */
export const ROW_H_DEFAULT = 40;
/** The row-scale bounds Ctrl+Shift+wheel moves between (a fraction of the token row height). */
export const ROW_SCALE_RANGE: readonly [number, number] = [0.7, 1.6];
/** One row-zoom notch's factor. */
export const ROW_SCALE_STEP = 1.1;
/**
 * How long (ms) a cursor zoom anchor survives without further zoom activity — the calendar
 * engine's own hold, restated here because this axis has its own store.
 */
export const ZOOM_ANCHOR_HOLD_MS = 600;
/** How far (px) the cursor may drift and still count as the SAME anchor. */
export const ZOOM_ANCHOR_SLOP_PX = 2;
/** Breathing room (px) left around a revealed item or lane. */
export const REVEAL_PAD = 24;
// #endregion

// #region Types
export interface GanttStoreOptions {
	/** The instant content-space `x = 0` stands for. Fixed for the store's life. */
	originMs: number;
	/** IANA display timezone. */
	timezone: string;
	/**
	 * The zoom (px per day): a host-owned signal, or a starting number the store then owns. A host
	 * that renders a zoom control elsewhere passes its own signal and the store writes back into it.
	 */
	pxPerDay?: Signal<number> | number;
	/** The zoom bounds — the spring, the wheel and the pinch all clamp into these. */
	zoomRange?: readonly [number, number];
	/** The un-scaled row height (px). Replaced by the token the palette resolves. */
	rowH?: number;
}

/** Everything the canvas, the header, the task list and the gestures read or write. */
export interface GanttStore {
	readonly originMs: number;
	readonly timezone: string;
	readonly zoomRange: readonly [number, number];
	/** Content-space x (px) at the viewport's inline-start edge. Unbounded but for the axis limit. */
	readonly scrollX: Signal<number>;
	/** Content-space y (px) at the viewport's top edge. Clamped to the lane range. */
	readonly scrollY: Signal<number>;
	/** The zoom, px per day. */
	readonly pxPerDay: Signal<number>;
	/** The vertical density multiplier (Ctrl+Shift+wheel). */
	readonly rowScale: Signal<number>;
	/** The token row height, before scaling. Written by the canvas hook from the palette. */
	readonly baseRowH: Signal<number>;
	readonly viewportW: Signal<number>;
	readonly viewportH: Signal<number>;
	readonly laneCount: Signal<number>;
	/** The item under the pointer. */
	readonly hoverId: Signal<string | null>;
	/** The lane index currently expanded on hover, or null. */
	readonly hoverLane: Signal<number | null>;
	/** How far (px) the hovered lane is expanded RIGHT NOW — resolved by the hook's spring. */
	readonly expandPx: Signal<number>;
	/** The item the accessible layer has focus on. */
	readonly focusId: Signal<string | null>;
	/** The item last opened. */
	readonly selectedId: Signal<string | null>;
	/** Whether a pan drag is in flight. */
	readonly panning: Signal<boolean>;
	/** The fly-mode origin in VIEWPORT px, or null when fly mode is off. */
	readonly fly: Signal<{ x: number; y: number } | null>;
	/** Whether the accessible scroll region itself holds focus. */
	readonly regionFocus: Signal<boolean>;
	/** Whether the surface is mirrored (`dir="rtl"`). */
	readonly rtl: Signal<boolean>;

	/** The effective row height (`baseRowH × rowScale`). */
	readonly rowH: ReadonlySignal<number>;
	readonly tier: ReadonlySignal<TimeTier>;
	/** The instants at the viewport's two inline edges. */
	readonly visibleRange: ReadonlySignal<GanttRange>;
	readonly contentH: ReadonlySignal<number>;
	readonly maxScrollY: ReadonlySignal<number>;

	/** Content-space x of an instant at the live zoom. */
	xOf(ms: number): number;
	/** Viewport x of an instant. */
	viewXOf(ms: number): number;
	/** The instant at a viewport x. */
	msAtViewX(viewX: number): number;
	/** The live geometry snapshot (peeked — safe inside effects and event handlers). */
	geometry(): RowGeometry;

	/** Write both offsets (either may be omitted). Clamped. */
	scrollTo(x?: number, y?: number): void;
	/** Move both offsets by a delta. Clamped. */
	scrollBy(dx: number, dy: number): void;
	/** Centre the viewport on an instant. */
	centerOn(ms: number): void;
	/** Scroll so a content-space x band is in view, doing nothing when it already is. */
	revealX(x0: number, x1: number): void;
	/** Scroll so lane `i` is in view, doing nothing when it already is. */
	revealLane(i: number): void;
	/**
	 * Pin the NEXT zoom change to a viewport x instead of the centre. The instant under it stays
	 * under it across the whole zoom. `null` returns to centre-pinning. The anchor lapses on its own
	 * after {@link ZOOM_ANCHOR_HOLD_MS} of no zoom activity.
	 */
	setZoomAnchor(viewX: number | null, now?: number): void;
	/** Write the zoom (clamped), re-solving the offset from the live anchor or the centre. */
	setZoom(pxPerDay: number, now?: number): void;
	/** Multiply the zoom by a factor — one wheel notch is {@link ZOOM_STEP}. */
	zoomBy(factor: number, now?: number): void;
	/** Set the zoom so `range` fills the viewport, and scroll to it. */
	fitRange(range: GanttRange, padFrac?: number): void;
	/** Multiply the row scale by a factor, clamped to {@link ROW_SCALE_RANGE}. */
	scaleRows(factor: number): void;
	/** Leave fly mode. */
	endFly(): void;
}
// #endregion

/** Create a store. One per timeline; never a module singleton — two timelines are two viewports. */
export function createGanttStore(opts: GanttStoreOptions): GanttStore {
	const originMs = opts.originMs;
	const timezone = opts.timezone;
	const zoomRange = opts.zoomRange ?? ZOOM_RANGE_DEFAULT;

	const pxPerDay = typeof opts.pxPerDay === "object"
		? opts.pxPerDay
		: signal(clampZoom(opts.pxPerDay ?? PX_PER_DAY_DEFAULT, zoomRange));
	// A host-owned signal may arrive outside the bounds; the store's first act is to respect them.
	if (pxPerDay.peek() !== clampZoom(pxPerDay.peek(), zoomRange)) {
		pxPerDay.value = clampZoom(pxPerDay.peek(), zoomRange);
	}

	const scrollX = signal(0);
	const scrollY = signal(0);
	const rowScale = signal(1);
	const baseRowH = signal(opts.rowH ?? ROW_H_DEFAULT);
	const viewportW = signal(0);
	const viewportH = signal(0);
	const laneCount = signal(0);
	const hoverId = signal<string | null>(null);
	const hoverLane = signal<number | null>(null);
	const expandPx = signal(0);
	const focusId = signal<string | null>(null);
	const selectedId = signal<string | null>(null);
	const panning = signal(false);
	const fly = signal<{ x: number; y: number } | null>(null);
	const regionFocus = signal(false);
	const rtl = signal(false);

	const rowH = computed(() => Math.max(8, baseRowH.value * rowScale.value));
	const tier = computed(() => tierFor(pxPerDay.value));
	const visibleRange = computed<GanttRange>(() => ({
		start: msAtX(scrollX.value, originMs, pxPerDay.value),
		end: msAtX(scrollX.value + Math.max(0, viewportW.value), originMs, pxPerDay.value),
	}));
	const contentH = computed(() =>
		contentHeight({
			rowH: rowH.value,
			laneCount: laneCount.value,
			hoverLane: hoverLane.value,
			expandPx: expandPx.value,
		})
	);
	const maxScrollY = computed(() => Math.max(0, contentH.value - viewportH.value));

	/** The instant at the viewport centre — held so a centre-pinned zoom re-pins in place. */
	let centerMs = originMs;
	/** The live cursor anchor, or null. */
	let anchor: { ms: number; viewX: number; expiresAt: number } | null = null;

	const geometry = (): RowGeometry => ({
		rowH: rowH.peek(),
		laneCount: laneCount.peek(),
		hoverLane: hoverLane.peek(),
		expandPx: expandPx.peek(),
	});

	const axisMin = () => xOfMs(originMs - AXIS_LIMIT_DAYS * 86_400_000, originMs, pxPerDay.peek());
	const axisMax = () => xOfMs(originMs + AXIS_LIMIT_DAYS * 86_400_000, originMs, pxPerDay.peek());

	/** Write the offsets clamped, and keep the centre instant honest for the next zoom. */
	function write(x: number | undefined, y: number | undefined): void {
		batch(() => {
			if (x !== undefined && Number.isFinite(x)) {
				const next = Math.min(axisMax(), Math.max(axisMin(), x));
				if (scrollX.peek() !== next) scrollX.value = next;
				centerMs = msAtX(next + viewportW.peek() / 2, originMs, pxPerDay.peek());
			}
			if (y !== undefined && Number.isFinite(y)) {
				const next = Math.min(maxScrollY.peek(), Math.max(0, y));
				if (scrollY.peek() !== next) scrollY.value = next;
			}
		});
	}

	function setZoom(next: number, now = Date.now()): void {
		const ppd = clampZoom(next, zoomRange);
		const w = viewportW.peek();
		batch(() => {
			if (anchor && now <= anchor.expiresAt) {
				anchor.expiresAt = now + ZOOM_ANCHOR_HOLD_MS;
				pxPerDay.value = ppd;
				const x = zoomedScrollX(anchor.ms, anchor.viewX, originMs, ppd);
				scrollX.value = Math.min(axisMax(), Math.max(axisMin(), x));
				// The centre genuinely moved; re-derive it from where the offset landed. The anchor's own
				// instant is untouched, which is what lets a zoom back restore it exactly.
				centerMs = msAtX(scrollX.peek() + w / 2, originMs, ppd);
				return;
			}
			anchor = null;
			const pinned = centerMs;
			pxPerDay.value = ppd;
			const x = xOfMs(pinned, originMs, ppd) - w / 2;
			scrollX.value = Math.min(axisMax(), Math.max(axisMin(), x));
			centerMs = pinned;
		});
	}

	return {
		originMs,
		timezone,
		zoomRange,
		scrollX,
		scrollY,
		pxPerDay,
		rowScale,
		baseRowH,
		viewportW,
		viewportH,
		laneCount,
		hoverId,
		hoverLane,
		expandPx,
		focusId,
		selectedId,
		panning,
		fly,
		regionFocus,
		rtl,
		rowH,
		tier,
		visibleRange,
		contentH,
		maxScrollY,
		geometry,
		xOf: (ms) => xOfMs(ms, originMs, pxPerDay.peek()),
		viewXOf: (ms) => xOfMs(ms, originMs, pxPerDay.peek()) - scrollX.peek(),
		msAtViewX: (viewX) => msAtX(scrollX.peek() + viewX, originMs, pxPerDay.peek()),
		scrollTo: (x, y) => write(x, y),
		scrollBy: (dx, dy) => write(scrollX.peek() + dx, scrollY.peek() + dy),
		centerOn: (ms) => write(xOfMs(ms, originMs, pxPerDay.peek()) - viewportW.peek() / 2, undefined),
		revealX: (x0, x1) => {
			const left = scrollX.peek();
			const w = viewportW.peek();
			if (w <= 0) return;
			if (x0 < left + REVEAL_PAD) write(x0 - REVEAL_PAD, undefined);
			else if (x1 > left + w - REVEAL_PAD) write(x1 - w + REVEAL_PAD, undefined);
		},
		revealLane: (i) => {
			const g = geometry();
			const top = i * g.rowH + (g.hoverLane !== null && i > g.hoverLane ? g.expandPx : 0);
			const bottom = top + g.rowH + (i === g.hoverLane ? g.expandPx : 0);
			const y = scrollY.peek();
			const h = viewportH.peek();
			if (h <= 0) return;
			if (top < y) write(undefined, top);
			else if (bottom > y + h) write(undefined, bottom - h);
		},
		setZoomAnchor: (viewX, now = Date.now()) => {
			if (viewX === null || !Number.isFinite(viewX)) {
				anchor = null;
				return;
			}
			// A LIVE anchor at the same place is EXTENDED, never re-derived: mid-gesture the scale and
			// the offset are momentarily out of step, and re-capturing against that pair compounds.
			if (
				anchor && anchor.expiresAt > now && Math.abs(anchor.viewX - viewX) <= ZOOM_ANCHOR_SLOP_PX
			) {
				anchor.expiresAt = now + ZOOM_ANCHOR_HOLD_MS;
				return;
			}
			anchor = {
				viewX,
				ms: msAtX(scrollX.peek() + viewX, originMs, pxPerDay.peek()),
				expiresAt: now + ZOOM_ANCHOR_HOLD_MS,
			};
		},
		setZoom,
		zoomBy: (factor, now) => setZoom(pxPerDay.peek() * factor, now),
		fitRange: (range, padFrac = 0.08) => {
			const w = viewportW.peek();
			if (w <= 0) return;
			const ppd = fitZoom(range, w, padFrac, zoomRange);
			anchor = null;
			batch(() => {
				pxPerDay.value = ppd;
				const mid = range.start + (range.end - range.start) / 2;
				write(xOfMs(mid, originMs, ppd) - w / 2, undefined);
			});
		},
		scaleRows: (factor) => {
			const next = Math.min(
				ROW_SCALE_RANGE[1],
				Math.max(ROW_SCALE_RANGE[0], rowScale.peek() * factor),
			);
			rowScale.value = next;
			// The content just got shorter or taller; the offset must stay inside it.
			write(undefined, scrollY.peek());
		},
		endFly: () => {
			if (fly.peek() !== null) fly.value = null;
		},
	};
}
