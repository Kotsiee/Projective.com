import { computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import { createSpring, SPRING_STANDARD } from "@ui/core/motion.ts";
import { readStored, type StorageKey, writeStored } from "@web/utils/storage-keys.ts";

/**
 * zoom-store — the ONE implementation of the cross-island view-density model that every zoom-driven
 * workspace on the platform shares (File Explorer · Submissions · Catalogue console · Wallet ledger ·
 * Workspace roster & people).
 *
 * The pattern it encodes: a footer **View Control Rig** and the workspace **body** are separate
 * hydration roots, so they cannot exchange props — they coordinate through module-level signals. A
 * single continuous `zoom` (0–1) drives BOTH the list⇄grid switch (a centre threshold) AND the
 * density within each half. The rig's mode glyph toggles the half directly (Decision #223) by
 * mirroring the density into the other half, so the slider and the toggle never disagree.
 *
 * Layout reads {@link ZoomStore.displayZoom}, never `zoom`: a discrete step (± button, wheel notch,
 * held button) eases toward its target on the over-damped standard spring, while a drag, a toggle and
 * a restore land at once — the instant-vs-animate split the media viewers use.
 *
 * SSR-safe: the signal seeds to a deterministic default (server and first client render agree) and the
 * persisted preference is restored on first island mount via {@link ZoomStore.restoreZoom}, so there is
 * never a hydration mismatch.
 *
 * Each surface instantiates its own store with its own {@link StorageKey}, so one workspace's density is
 * independent of another's; the maths ramps are per-surface because a file thumbnail, a listing card
 * and a member card do not want the same column widths.
 */

// #region Types
/** Which presentation a zoom value selects. */
export type ZoomViewMode = "list" | "grid";

/** How layout reaches a new zoom: eased (a discrete step) or at once (a drag, a toggle, a restore). */
export type ZoomMotion = "instant" | "animate";

/** Per-surface tuning for {@link createZoomStore}. All fields are optional bar the storage key. */
export interface ZoomStoreOptions {
	/** Where the preference persists. Distinct per surface so densities never bleed into each other. */
	storageKey: StorageKey;
	/** The deterministic SSR seed (0–1). Default `0.62` — a comfortable mid grid. */
	initial?: number;
	/** Number of segments on the rig's track. Default `8`. */
	segments?: number;
	/** The exact list⇄grid transition point — the rig's centre marker. Default `0.5`. */
	center?: number;
	/** `Ctrl`+wheel zoom per wheel notch (one 100px `deltaY`). Default `0.04`. */
	wheelStep?: number;
	/** ± button / Arrow-key step. Default `0.05`. */
	step?: number;
	/** Grid card column width (px) at the centre marker → at max zoom. */
	gridColumn?: { min: number; max: number };
	/** List/table row height (px) at zero density → at the centre marker. */
	listRow?: { min: number; max: number };
}

/** The signals + pure maths one zoom-driven surface shares between its rig and its body. */
export interface ZoomStore {
	/** The target zoom (0–1) — what the rig shows and what persists. Layout reads {@link displayZoom}. */
	readonly zoom: Signal<number>;
	/** The zoom layout renders at: `zoom` followed by a spring (lands at once under reduced motion). */
	readonly displayZoom: ReadonlySignal<number>;
	/** Which presentation the target zoom selects. */
	readonly viewMode: ReadonlySignal<ZoomViewMode>;
	readonly ZOOM_MIN: number;
	readonly ZOOM_MAX: number;
	readonly ZOOM_CENTER: number;
	readonly ZOOM_SEGMENTS: number;
	readonly ZOOM_STEP: number;
	readonly ZOOM_WHEEL_STEP: number;
	/** Restore the persisted preference once, client-only, on first island mount. */
	restoreZoom(): void;
	/** Set the target zoom and persist it on a trailing debounce; `motion` defaults to `"instant"`. */
	setZoom(next: number, motion?: ZoomMotion): void;
	/** Nudge the zoom by a signed delta — the `Ctrl`+wheel / ± button path; eased by default. */
	nudgeZoom(delta: number, motion?: ZoomMotion): void;
	/** Switch list ⇄ grid at the same relative density within the other half, instantly. */
	toggleViewMode(): void;
	/** Grid card column width (px) for a zoom. */
	gridColWidth(z: number): number;
	/** 0–1 density within the LIST half (0 at the far left, 1 at the centre marker). */
	listDensity(z: number): number;
	/** List/table row height (px) — grows with density. */
	listRowHeight(z: number): number;
}
// #endregion

// #region Factory
/**
 * A synchronous write to `localStorage` on every tick would add main-thread jank on top of the
 * per-tick re-render — a fast `Ctrl`+wheel or slider drag fires dozens of updates a second — so the
 * value drives the UI immediately and persists on a trailing debounce.
 */
const PERSIST_DEBOUNCE_MS = 200;

/** Spring settle threshold in zoom units — well under a pixel on every column and row ramp. */
const SPRING_EPSILON = 0.0005;

/** How far below the centre a grid→list toggle lands, so the mirrored zoom never reads as grid. */
const MODE_EDGE = 0.01;

/** Build one surface's zoom store. Call at module scope so the signals are shared across islands. */
export function createZoomStore(options: ZoomStoreOptions): ZoomStore {
	const ZOOM_MIN = 0;
	const ZOOM_MAX = 1;
	const ZOOM_CENTER = options.center ?? 0.5;
	const ZOOM_SEGMENTS = options.segments ?? 8;
	const ZOOM_STEP = options.step ?? 0.05;
	const ZOOM_WHEEL_STEP = options.wheelStep ?? 0.04;
	const grid = options.gridColumn ?? { min: 116, max: 284 };
	const row = options.listRow ?? { min: 38, max: 78 };

	const clamp01 = (n: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, n));

	const zoom = signal<number>(clamp01(options.initial ?? 0.62));
	const spring = createSpring(zoom.peek(), { config: SPRING_STANDARD, epsilon: SPRING_EPSILON });
	const viewMode = computed<ZoomViewMode>(() => (zoom.value < ZOOM_CENTER ? "list" : "grid"));

	let restored = false;
	let persistTimer: ReturnType<typeof setTimeout> | null = null;

	function setZoom(next: number, motion: ZoomMotion = "instant"): void {
		zoom.value = clamp01(next);
		if (motion === "animate") spring.set(zoom.peek());
		else spring.jump(zoom.peek());
		if (persistTimer !== null) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			writeStored("local", options.storageKey, String(zoom.peek()));
			persistTimer = null;
		}, PERSIST_DEBOUNCE_MS);
	}

	function listDensity(z: number): number {
		return clamp01(z / ZOOM_CENTER);
	}

	function mirroredZoom(z: number): number {
		if (z < ZOOM_CENTER) return ZOOM_CENTER + listDensity(z) * (ZOOM_MAX - ZOOM_CENTER);
		const t = (z - ZOOM_CENTER) / (ZOOM_MAX - ZOOM_CENTER);
		return Math.min(t * ZOOM_CENTER, ZOOM_CENTER - MODE_EDGE);
	}

	return {
		zoom,
		displayZoom: spring.value,
		viewMode,
		ZOOM_MIN,
		ZOOM_MAX,
		ZOOM_CENTER,
		ZOOM_SEGMENTS,
		ZOOM_STEP,
		ZOOM_WHEEL_STEP,
		restoreZoom(): void {
			if (restored) return;
			restored = true;
			const raw = readStored("local", options.storageKey);
			const n = raw ? Number(raw) : NaN;
			if (!Number.isFinite(n)) return;
			zoom.value = clamp01(n);
			spring.jump(zoom.peek());
		},
		setZoom,
		nudgeZoom(delta: number, motion: ZoomMotion = "animate"): void {
			setZoom(zoom.peek() + delta, motion);
		},
		toggleViewMode(): void {
			setZoom(mirroredZoom(zoom.peek()), "instant");
		},
		gridColWidth(z: number): number {
			const t = clamp01((z - ZOOM_CENTER) / (ZOOM_MAX - ZOOM_CENTER));
			return grid.min + t * (grid.max - grid.min);
		},
		listDensity,
		listRowHeight(z: number): number {
			return Math.round(row.min + listDensity(z) * (row.max - row.min));
		},
	};
}
// #endregion
