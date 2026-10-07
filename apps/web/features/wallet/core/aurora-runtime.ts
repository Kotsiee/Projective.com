/**
 * aurora-runtime.ts — the life of the wallet hero's live aurora: whether a canvas is mounted, which
 * renderer drives it, when it draws, when it pauses, and when it gives up for good.
 *
 * Framework-free. The view (`HeroAurora.tsx`) renders a `<canvas>` while this runtime asks it to (a
 * new element per key, so a context that failed never poisons the next one) and hands the element
 * back through {@link AuroraRuntime.attach}. Every decision is made by the pure functions in
 * `aurora-engine.ts`; this module only reads the environment, wires the listeners, and runs the loop.
 *
 * DOM contract, all on the hero element:
 * - `data-aurora` — `static` · `webgl2` · `canvas2d` · `stopped` ({@link AuroraState}).
 * - `data-aurora-reason` — why it is not plain WebGL2 ({@link AuroraReason}); absent when it is.
 * - `data-aurora-paused` — `hidden` · `offscreen` while a mounted aurora is not drawing.
 * - `data-aurora-p95` — the sampled p95 frame time in ms, once the first frames are measured.
 */

import {
	advanceClock,
	AURORA_MIN_CEILING,
	AURORA_SETTLE_TIMEOUT_MS,
	AURORA_STALL_TICK_MS,
	AURORA_WARMUP_FRAMES,
	auroraCeiling,
	type AuroraEnvironment,
	type AuroraMode,
	type AuroraPalette,
	type AuroraPause,
	type AuroraReason,
	type AuroraState,
	decideAurora,
	FrameSampler,
	isFrameStalled,
	shouldDraw,
} from "./aurora-engine.ts";
import {
	type AuroraColors,
	type AuroraRenderer,
	createCanvas2DRenderer,
	createWebGL2Renderer,
	readAuroraColors,
} from "./aurora-render.ts";

// #region Contract
/** Options for {@link createAuroraRuntime}. */
export interface AuroraRuntimeOptions {
	/** The hero: the attribute host, the token source and the visibility target. */
	host: HTMLElement;
	/** The initial {@link AuroraMode}. */
	mode: AuroraMode;
	/**
	 * Render a canvas keyed `key` (a fresh element whenever the key changes), or none when `key` is 0.
	 * The view passes the element it rendered back through {@link AuroraRuntime.attach}.
	 */
	setCanvasKey: (key: number) => void;
}

/** A running aurora controller. */
export interface AuroraRuntime {
	/** The view's ref callback for the canvas it rendered (`null` when it removed it). */
	attach(canvas: HTMLCanvasElement | null): void;
	/** Switch {@link AuroraMode} live (the Dev Context Switcher's `walletAurora` axis). */
	setMode(mode: AuroraMode): void;
	/** Stop everything, release the context, remove every listener and attribute. */
	destroy(): void;
}

/** The non-standard navigator hints the gates read, where the browser exposes them. */
interface NavigatorHints {
	connection?: EventTarget & { saveData?: boolean };
	deviceMemory?: number;
	hardwareConcurrency?: number;
}

/** A failure that ends the aurora for the page view, and the state it leaves behind. */
interface Latch {
	state: AuroraState;
	reason: AuroraReason;
}

const THEME_ATTRIBUTES = ["data-motion", "data-theme", "data-contrast", "data-cvd", "style"];
// #endregion

// #region Runtime
/** Start the aurora controller for one hero. */
export function createAuroraRuntime(options: AuroraRuntimeOptions): AuroraRuntime {
	const { host, setCanvasKey } = options;
	const root = document.documentElement;
	const nav = navigator as Navigator & NavigatorHints;
	const motionQuery = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

	let mode = options.mode;
	let destroyed = false;
	let latch: Latch | null = null;

	let key = 0;
	let canvas: HTMLCanvasElement | null = null;
	let renderer: AuroraRenderer | null = null;
	let preferCpu = false;
	let cpuReason: AuroraReason | null = null;

	let palette: AuroraPalette | null = null;
	let ceiling = 0;
	let colorsDirty = true;
	let solvedFor = "";
	let solved = 0;

	let onScreen = true;
	let sizeDirty = true;
	let painted = false;
	let revealPending = false;

	let raf = 0;
	let lastRafAt: number | null = null;
	let lastDrawAt = Number.NEGATIVE_INFINITY;
	let clock = 0;
	let sampler = new FrameSampler();
	let warmup = AURORA_WARMUP_FRAMES;
	/** The page has loaded and then gone idle once (or the settle timeout passed): sampling may begin. */
	let settled = false;
	let cancelSettle: (() => void) | null = null;

	let stallTimer: ReturnType<typeof setInterval> | null = null;
	let lastFrameAt = 0;
	let ticksSinceFrame = 0;

	// #region Attributes
	function writeState(state: AuroraState, reason: AuroraReason | null): void {
		host.dataset.aurora = state;
		if (reason) host.dataset.auroraReason = reason;
		else delete host.dataset.auroraReason;
		if (state === "static" || state === "stopped") delete host.dataset.auroraPaused;
	}

	function writePause(pause: AuroraPause | null): void {
		if (pause) host.dataset.auroraPaused = pause;
		else delete host.dataset.auroraPaused;
	}
	// #endregion

	// #region Environment
	function readEnvironment(): AuroraEnvironment {
		return {
			reducedMotion: (motionQuery?.matches ?? false) || root.dataset.motion === "reduced",
			saveData: nav.connection?.saveData,
			deviceMemory: nav.deviceMemory,
			hardwareConcurrency: nav.hardwareConcurrency,
			hidden: document.hidden,
		};
	}

	/** The ceiling for a set of inks, solved once per distinct set (a theme flip rarely changes them). */
	function ceilingFor(colors: AuroraColors): number {
		const inks = JSON.stringify([colors.ink, colors.softInk, colors.glassFill]);
		if (inks !== solvedFor) {
			solved = auroraCeiling(colors.ink, colors.softInk, colors.glassFill);
			solvedFor = inks;
		}
		return solved;
	}

	/** Resolve the palette and the ceiling if the cascade changed; on failure the aurora goes static. */
	function ensureColors(): boolean {
		if (!colorsDirty && palette) return true;
		const colors = readAuroraColors(host);
		const nextCeiling = colors ? ceilingFor(colors) : 0;
		if (!colors || nextCeiling < AURORA_MIN_CEILING) {
			palette = null;
			unmount();
			writeState("static", colors ? "contrast" : "no-color");
			return false;
		}
		palette = colors.palette;
		ceiling = nextCeiling;
		colorsDirty = false;
		renderer?.setPalette(palette, ceiling);
		return true;
	}
	// #endregion

	// #region Mounting
	function unmount(): void {
		stopLoop();
		renderer?.dispose();
		renderer = null;
		canvas = null;
		painted = false;
		revealPending = false;
		if (key !== 0) {
			key = 0;
			setCanvasKey(0);
		}
	}

	function remount(): void {
		stopLoop();
		renderer?.dispose();
		renderer = null;
		canvas = null;
		key += 1;
		setCanvasKey(key);
	}

	function fail(reason: AuroraReason): void {
		latch = { state: "stopped", reason };
		unmount();
		writeState("stopped", reason);
	}

	function attach(el: HTMLCanvasElement | null): void {
		if (destroyed || !el || el === canvas || key === 0 || renderer) return;
		canvas = el;
		let next: AuroraRenderer | null = null;
		if (!preferCpu) {
			const gl = createWebGL2Renderer(el, {
				allowSoftware: mode === "animated",
				onLost: () => fail("context-lost"),
			});
			if (gl.ok) next = gl.renderer;
			else {
				preferCpu = true;
				cpuReason = "no-webgl";
				if (gl.reason === "tainted") {
					remount();
					return;
				}
			}
		}
		next ??= createCanvas2DRenderer(el);
		if (!next) {
			latch = { state: "static", reason: "no-canvas" };
			unmount();
			writeState("static", "no-canvas");
			return;
		}
		renderer = next;
		if (palette) renderer.setPalette(palette, ceiling);
		sizeDirty = true;
		painted = false;
		writeState(renderer.kind, renderer.kind === "canvas2d" ? cpuReason : null);
		syncLoop();
	}
	// #endregion

	// #region Loop
	function watchdogArmed(): boolean {
		return mode === "auto";
	}

	function frame(now: number): void {
		raf = requestAnimationFrame(frame);
		lastFrameAt = now;
		ticksSinceFrame = 0;
		if (lastRafAt !== null) {
			const interval = now - lastRafAt;
			clock = advanceClock(clock, interval);
			if (sampler.verdict === "sampling" && settled) {
				if (warmup > 0) warmup -= 1;
				else {
					const verdict = sampler.record(interval);
					if (verdict !== "sampling") host.dataset.auroraP95 = (sampler.p95 ?? 0).toFixed(1);
					if (verdict === "fail" && watchdogArmed()) {
						fail("watchdog-p95");
						return;
					}
				}
			}
		}
		lastRafAt = now;

		if (revealPending && canvas) {
			canvas.dataset.painted = "true";
			revealPending = false;
		}
		if (!renderer || !shouldDraw(now, lastDrawAt)) return;
		lastDrawAt = now;
		if (colorsDirty && !ensureColors()) return;
		try {
			if (sizeDirty) {
				renderer.resize(host.clientWidth, host.clientHeight);
				sizeDirty = false;
			}
			renderer.draw(clock);
		} catch {
			fail("render-error");
			return;
		}
		if (!painted) {
			painted = true;
			revealPending = true;
		}
	}

	function startStallTimer(): void {
		if (stallTimer !== null || !watchdogArmed()) return;
		stallTimer = setInterval(() => {
			if (!raf || document.hidden) return;
			ticksSinceFrame += 1;
			if (isFrameStalled(performance.now() - lastFrameAt, ticksSinceFrame)) fail("watchdog-stall");
		}, AURORA_STALL_TICK_MS);
	}

	function stopStallTimer(): void {
		if (stallTimer === null) return;
		clearInterval(stallTimer);
		stallTimer = null;
	}

	function stopLoop(): void {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		stopStallTimer();
	}

	/** Run the loop exactly while a renderer exists and the hero can be seen. */
	function syncLoop(): void {
		if (!renderer) return;
		const visible = !document.hidden && onScreen;
		if (visible && !raf) {
			lastRafAt = null;
			lastFrameAt = performance.now();
			ticksSinceFrame = 0;
			raf = requestAnimationFrame(frame);
			startStallTimer();
		} else if (!visible && raf) {
			stopLoop();
		}
		writePause(visible ? null : document.hidden ? "hidden" : "offscreen");
	}
	// #endregion

	// #region Decisions
	function evaluate(): void {
		if (destroyed || latch) return;
		const verdict = decideAurora(readEnvironment(), mode);
		if (verdict.action === "block") {
			unmount();
			writeState("static", verdict.reason);
			return;
		}
		if (verdict.action === "wait") {
			if (renderer) syncLoop();
			else if (key === 0) writeState("static", verdict.reason);
			return;
		}
		if (renderer) {
			if (colorsDirty) ensureColors();
			syncLoop();
			return;
		}
		if (key !== 0) return;
		if (!ensureColors()) return;
		key += 1;
		setCanvasKey(key);
	}

	function setMode(next: AuroraMode): void {
		if (destroyed || next === mode) return;
		mode = next;
		// Forcing the shader on is an explicit developer request, so it is the one thing that lifts a
		// failure latch — with a fresh sampler, so the new run reports its own p95.
		if (next === "animated" && latch?.state === "stopped") {
			latch = null;
			preferCpu = false;
			cpuReason = null;
			sampler = new FrameSampler();
			warmup = AURORA_WARMUP_FRAMES;
			delete host.dataset.auroraP95;
		}
		if (watchdogArmed()) {
			if (renderer && sampler.verdict === "fail") {
				fail("watchdog-p95");
				return;
			}
			if (raf) startStallTimer();
		} else {
			stopStallTimer();
		}
		evaluate();
	}
	// #endregion

	// #region Listeners
	const markSettled = () => {
		cancelSettle = null;
		settled = true;
	};
	/** After `load`, wait for one idle period so the watchdog samples the aurora, not the page arriving. */
	const settle = () => {
		if (destroyed) return;
		if (typeof globalThis.requestIdleCallback === "function") {
			const id = globalThis.requestIdleCallback(markSettled, { timeout: AURORA_SETTLE_TIMEOUT_MS });
			cancelSettle = () => globalThis.cancelIdleCallback(id);
		} else {
			const id = setTimeout(markSettled, AURORA_SETTLE_TIMEOUT_MS);
			cancelSettle = () => clearTimeout(id);
		}
	};
	if (document.readyState === "complete") settle();
	else globalThis.addEventListener("load", settle, { once: true });

	const onThemeMutation = (records: MutationRecord[]) => {
		if (records.some((r) => r.attributeName !== "data-motion")) colorsDirty = true;
		evaluate();
	};
	const themeObserver = new MutationObserver(onThemeMutation);
	themeObserver.observe(root, { attributes: true, attributeFilter: THEME_ATTRIBUTES });

	const visibilityObserver = typeof IntersectionObserver === "function"
		? new IntersectionObserver((entries) => {
			const last = entries[entries.length - 1];
			if (!last) return;
			onScreen = last.isIntersecting;
			syncLoop();
		})
		: null;
	visibilityObserver?.observe(host);

	const sizeObserver = typeof ResizeObserver === "function"
		? new ResizeObserver(() => {
			sizeDirty = true;
		})
		: null;
	sizeObserver?.observe(host);

	motionQuery?.addEventListener?.("change", evaluate);
	document.addEventListener("visibilitychange", evaluate);
	nav.connection?.addEventListener?.("change", evaluate);
	// #endregion

	evaluate();

	return {
		attach,
		setMode,
		destroy() {
			if (destroyed) return;
			destroyed = true;
			unmount();
			globalThis.removeEventListener("load", settle);
			cancelSettle?.();
			themeObserver.disconnect();
			visibilityObserver?.disconnect();
			sizeObserver?.disconnect();
			motionQuery?.removeEventListener?.("change", evaluate);
			document.removeEventListener("visibilitychange", evaluate);
			nav.connection?.removeEventListener?.("change", evaluate);
			delete host.dataset.aurora;
			delete host.dataset.auroraReason;
			delete host.dataset.auroraPaused;
			delete host.dataset.auroraP95;
		},
	};
}
// #endregion
