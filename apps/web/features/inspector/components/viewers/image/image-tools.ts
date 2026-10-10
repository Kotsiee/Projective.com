import { computed, type ReadonlySignal, type Signal, signal } from "@preact/signals";
import type { InspectorShell, StageFact } from "../../../core/inspector-shell.ts";
import {
	aspectRatioLabel,
	clampPan,
	clampZoom,
	fit,
	fitView,
	flip,
	type FlipAxis,
	isFitted,
	panBy,
	type Point,
	quarterTurn,
	rotateBy,
	type Size,
	sliderPosition,
	VIEWPORT_IDENTITY,
	type ViewportFrame,
	type ViewportState,
	ZOOM_STEP,
	zoomAt,
	type ZoomLimits,
	zoomLimits,
	zoomPercent,
	zoomTo,
} from "../../../core/viewport.ts";

// #region Types
/** What shows through transparent pixels and around the picture. */
export type ImageBackground = "checker" | "dark" | "light";

/** How the stage draws the next view: eased (a discrete action) or at once (a drag, a wheel). */
export type ViewMotion = "instant" | "animate";

/** The image canvas's state and commands, shared by its stage, floating bar and panel controls. */
export interface ImageTools {
	/** Vector art: fitted beyond 100% and never drawn pixelated. */
	readonly vector: boolean;
	/** The address the stage draws: the canvas source, or the stored preview after a failed decode. */
	readonly source: Signal<string>;
	/** Whether the stage fell back to the stored preview. */
	readonly fallbackUsed: Signal<boolean>;
	/** The picture's natural size, once decoded. */
	readonly natural: Signal<Size | null>;
	/** The stage's measured size. */
	readonly container: Signal<Size>;
	readonly view: Signal<ViewportState>;
	readonly motion: Signal<ViewMotion>;
	readonly background: Signal<ImageBackground>;
	/** Whether the rule-of-thirds guide is drawn over the picture. */
	readonly grid: Signal<boolean>;
	/** Logarithmic zoom slider position, kept in step with {@link view}. */
	readonly zoomSlider: Signal<number>;
	/** Whether the picture follows the stage's size (it was fitted and not moved since). */
	readonly following: Signal<boolean>;
	readonly ready: ReadonlySignal<boolean>;
	readonly fitZoom: ReadonlySignal<number>;
	readonly limits: ReadonlySignal<ZoomLimits>;
	/**
	 * The picture as decoded: record its size, fit it, publish the facts and report ready. `exact` is
	 * false for a sizeless drawing laid out at a guessed size.
	 */
	loaded(size: Size, exact: boolean): void;
	/** The picture failed to decode: try the stored preview once, else give up. */
	failed(): void;
	/** The stage was measured. */
	resize(size: Size): void;
	/** Scale by a factor about a stage point (continuous input: wheel, pinch). */
	zoomAround(point: Point, factor: number): void;
	/** One zoom step in or out about the centre (buttons, keys). */
	zoomStep(direction: 1 | -1): void;
	/** Set the zoom from the slider. */
	zoomToLevel(zoom: number): void;
	fitToStage(): void;
	/** 100%, about a stage point or the centre. */
	actualSize(point?: Point | null): void;
	/** Double-click/tap: fitted ↔ 100% at the point. */
	toggleFit(point: Point): void;
	pan(dx: number, dy: number, motion?: ViewMotion): void;
	rotate(turns: 1 | -1): void;
	flipAxis(axis: FlipAxis): void;
	reset(): void;
	/** Show or hide the rule-of-thirds guide. */
	toggleGrid(): void;
}
// #endregion

const VECTOR_FIT = { upscale: true } as const;
const BITMAP_FIT = { upscale: false } as const;

function sameSize(a: Size, b: Size): boolean {
	return a.width === b.width && a.height === b.height;
}

function canHaveAlpha(ext: string, vector: boolean): boolean {
	return vector || ["png", "apng", "gif", "webp", "avif", "ico", "cur"].includes(ext.toLowerCase());
}

/**
 * Create the image canvas's state for one shell. Pure signals and closures, so it is safe during
 * SSR; the stage feeds it measurements and the decoded size, every control drives it.
 */
export function createImageTools(shell: InspectorShell): ImageTools {
	const { asset } = shell;
	const vector = asset.viewer === "svg";
	const fitOptions = vector ? VECTOR_FIT : BITMAP_FIT;
	const source = signal(asset.src);
	const fallbackUsed = signal(false);
	const natural = signal<Size | null>(null);
	const container = signal<Size>({ width: 0, height: 0 });
	const view = signal<ViewportState>({ ...VIEWPORT_IDENTITY });
	const motion = signal<ViewMotion>("instant");
	const background = signal<ImageBackground>(canHaveAlpha(asset.ext, vector) ? "checker" : "dark");
	const following = signal(true);
	const grid = signal(false);

	const ready = computed(() => {
		const size = container.value;
		return natural.value !== null && size.width > 0 && size.height > 0;
	});
	const fitZoom = computed(() => {
		const size = natural.value;
		return size ? fit(container.value, size, view.value.rotation, fitOptions) : 1;
	});
	const limits = computed(() => zoomLimits(fitZoom.value));
	const zoomSlider = signal(sliderPosition(1, zoomLimits(1)));

	function frame(): ViewportFrame | null {
		const size = natural.peek();
		const box = container.peek();
		if (!size || box.width <= 0 || box.height <= 0) return null;
		return { container: box, natural: size, limits: limits.peek() };
	}

	function commit(next: ViewportState, how: ViewMotion, follow: boolean): void {
		following.value = follow;
		motion.value = how;
		view.value = next;
		zoomSlider.value = sliderPosition(next.zoom, limits.peek());
	}

	function say(message: string): void {
		shell.announce(message);
	}

	function fitted(state: ViewportState, f: ViewportFrame): ViewportState {
		return fitView(state, f.container, f.natural, fitOptions);
	}

	function publishFacts(size: Size, exact: boolean): void {
		const facts: StageFact[] = [];
		const rendition = fallbackUsed.peek() ||
			(asset.previewSrc !== null && source.peek() === asset.previewSrc);
		if (rendition) {
			facts.push({
				label: "Showing",
				value: `Preview rendition · ${size.width} × ${size.height} px`,
			});
		} else if (exact && (asset.width === null || asset.height === null)) {
			facts.push({ label: "Dimensions", value: `${size.width} × ${size.height} px` });
		}
		const ratio = exact ? aspectRatioLabel(size.width, size.height) : null;
		if (ratio) facts.push({ label: "Aspect ratio", value: ratio });
		shell.facts.value = facts;
	}

	function fitToStage(): void {
		const f = frame();
		if (!f) return;
		const next = fitted(view.peek(), f);
		commit(next, "animate", true);
		say(`Fit to screen, ${zoomPercent(next.zoom)}`);
	}

	function actualSize(point: Point | null = null): void {
		const f = frame();
		if (!f) return;
		commit(zoomTo(view.peek(), 1, point, f), "animate", false);
		say("Actual size, 100%");
	}

	return {
		vector,
		source,
		fallbackUsed,
		natural,
		container,
		view,
		motion,
		background,
		grid,
		zoomSlider,
		following,
		ready,
		fitZoom,
		limits,
		loaded(size, exact) {
			natural.value = size;
			const f = frame();
			if (f) commit(fitted(view.peek(), f), "instant", true);
			publishFacts(size, exact);
			if (shell.status.peek() === "loading") shell.status.value = "ready";
		},
		failed() {
			const preview = asset.previewSrc;
			if (!fallbackUsed.peek() && preview !== null && preview !== source.peek()) {
				fallbackUsed.value = true;
				natural.value = null;
				source.value = preview;
				return;
			}
			shell.fail(
				vector ? "This drawing couldn't be displayed." : "This image couldn't be decoded.",
			);
		},
		resize(size) {
			if (sameSize(size, container.peek())) return;
			container.value = size;
			const f = frame();
			if (!f) return;
			const current = view.peek();
			const next = following.peek()
				? fitted(current, f)
				: clampPan({ ...current, zoom: clampZoom(current.zoom, f.limits) }, f.container, f.natural);
			commit(next, "instant", following.peek());
		},
		zoomAround(point, factor) {
			const f = frame();
			if (f) commit(zoomAt(view.peek(), point, factor, f), "instant", false);
		},
		zoomStep(direction) {
			const f = frame();
			if (!f) return;
			const next = zoomTo(view.peek(), view.peek().zoom * ZOOM_STEP ** direction, null, f);
			commit(next, "animate", false);
			say(`Zoom ${zoomPercent(next.zoom)}`);
		},
		zoomToLevel(zoom) {
			const f = frame();
			if (f) commit(zoomTo(view.peek(), zoom, null, f), "instant", false);
		},
		fitToStage,
		actualSize,
		toggleFit(point) {
			const fitScale = fitZoom.peek();
			if (!isFitted(view.peek(), fitScale)) {
				fitToStage();
				return;
			}
			if (fitScale < 1 - 1e-4) {
				actualSize(point);
				return;
			}
			const f = frame();
			if (!f) return;
			const next = zoomTo(view.peek(), fitScale * 2, point, f);
			commit(next, "animate", false);
			say(`Zoom ${zoomPercent(next.zoom)}`);
		},
		pan(dx, dy, how = "instant") {
			const f = frame();
			if (f) commit(panBy(view.peek(), dx, dy, f), how, false);
		},
		rotate(turns) {
			const f = frame();
			if (!f) return;
			const turned = rotateBy(view.peek(), turns);
			const follow = following.peek();
			const refit = fit(f.container, f.natural, turned.rotation, fitOptions);
			const next = follow ? { ...turned, zoom: refit, x: 0, y: 0 } : clampPan(
				{ ...turned, zoom: clampZoom(turned.zoom, zoomLimits(refit)) },
				f.container,
				f.natural,
			);
			commit(next, "animate", follow);
			say(`Rotated to ${quarterTurn(next.rotation)}°`);
		},
		flipAxis(axis) {
			const f = frame();
			if (!f) return;
			const next = clampPan(flip(view.peek(), axis), f.container, f.natural);
			commit(next, "animate", following.peek());
			const on = axis === "horizontal" ? next.flipX : next.flipY;
			say(`${axis === "horizontal" ? "Horizontal" : "Vertical"} flip ${on ? "on" : "off"}`);
		},
		reset() {
			const f = frame();
			if (!f) return;
			commit(fitted({ ...VIEWPORT_IDENTITY }, f), "animate", true);
			say("View reset");
		},
		toggleGrid() {
			grid.value = !grid.peek();
			say(grid.peek() ? "Rule of thirds shown" : "Rule of thirds hidden");
		},
	};
}
