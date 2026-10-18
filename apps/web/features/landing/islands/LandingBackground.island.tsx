/// <reference lib="dom" />
import "../styles/lp-background.css";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { BackgroundFallback } from "../components/BackgroundFallback.tsx";
import {
	type BackgroundFailure,
	type BackgroundForce,
	type BackgroundSnapshot,
	type BackgroundVerdict,
	decideBackground,
	parseBackgroundForce,
} from "../core/background-gate.ts";
import { buildZones, type Zone, type ZoneRect } from "../core/constellation.ts";
import type { ConstellationHandle } from "../core/constellation-gl.ts";
import { HEADER_TOP_BAND_PX } from "../core/header.ts";

// #region Contract
/** Props for {@link LandingBackground}. */
export interface LandingBackgroundProps {
	/** Which background; only the hero's exists today. */
	variant?: "hero";
}

/** The non-standard navigator hints the gate reads, where the browser exposes them. */
interface NavigatorHints {
	connection?: EventTarget & { saveData?: boolean };
	deviceMemory?: number;
}

/** The longest the WebGL upgrade waits for an idle period after first paint (ms). */
const IDLE_TIMEOUT_MS = 2000;

/** Where `requestIdleCallback` is missing, the upgrade waits this long instead (ms). */
const IDLE_FALLBACK_MS = 1200;

/**
 * The most text runs measured into quiet zones per pass; past it the whole background is one copy
 * zone, so unmeasured text is never left over a full-alpha node.
 */
const MAX_TEXT_RUNS = 64;

/** Explicit quiet regions; the search field and anything marked `halo` get the halo box. */
const COPY_SELECTOR = '[data-lp-quiet="copy"]';
const HALO_SELECTOR = '.lp-search, [data-lp-quiet="halo"]';

/** Subtrees whose text never needs a quiet zone: the background itself and inert (opaque) stages. */
const SKIP_SELECTOR = ".lp-bg, [inert]";

/** The floating header pill, a sibling of `<main>` that sits over the hero's top band. */
const HEADER_SELECTOR = ".lp-header";

/** Where the pill can shed its glass (`--bp-lg`, `lp-shell.css`); below it the glass always shows. */
const HEADER_CLEAR_QUERY = "(min-width: 1024px)";

const ROOT_ATTRIBUTES = ["data-motion", "data-theme", "data-contrast", "data-font"];
// #endregion

// #region Environment
/** The developer's `landingBackground` choice; always `auto` in production, where the seam is inert. */
function devForce(): BackgroundForce {
	return parseBackgroundForce(readDevSeam()?.landingBackground);
}

/** A length token (`32px`, `2rem`) in CSS px, or 0 when it does not resolve. */
function readLength(el: HTMLElement, token: string): number {
	const raw = getComputedStyle(el).getPropertyValue(token).trim();
	const value = Number.parseFloat(raw);
	if (!Number.isFinite(value)) return 0;
	if (raw.endsWith("rem")) {
		return value * Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
	}
	return value;
}
// #endregion

// #region Controller
/**
 * Run the hero background for `host` (the `.lp-bg` element) until the returned stop function is
 * called: read the environment, ask the gate, and drive the spotlight, the quiet-zone measurement and
 * the lazily imported WebGL2 constellation from its answer. Every listener and observer is a stable
 * function created here, so each is removed by identity on stop.
 */
function startBackground(host: HTMLElement, publishZones: (zones: readonly Zone[]) => void) {
	const root = document.documentElement;
	const shell = host.closest<HTMLElement>(".lp-root");
	const reflectOn = shell ?? host;
	const hero = host.parentElement ?? host;
	const header = shell?.querySelector<HTMLElement>(HEADER_SELECTOR) ?? null;
	const nav = navigator as Navigator & NavigatorHints;
	const query = (q: string) => globalThis.matchMedia?.(q) ?? null;
	const motionQuery = query("(prefers-reduced-motion: reduce)");
	const pointerQuery = query("(hover: hover) and (pointer: fine)");
	const forcedQuery = query("(forced-colors: active)");
	const contrastQuery = query("(prefers-contrast: more)");
	const headerQuery = query(HEADER_CLEAR_QUERY);

	let stopped = false;
	let intersecting = false;
	let webgl2: boolean | null = typeof WebGL2RenderingContext === "function" ? null : false;
	let failure: BackgroundFailure | null = null;
	let force = devForce();
	let verdict: BackgroundVerdict = decideBackground(snapshot());

	let gl: ConstellationHandle | null = null;
	let glPhase: "none" | "waiting" | "loading" | "mounted" = "none";
	let glLive = false;
	let glLost = false;
	let cancelWait: (() => void) | null = null;

	let zones: readonly Zone[] = [];
	let zonesKey = "";
	let zonesRaf = 0;

	let spot: "off" | "paused" | "on" = "off";
	let spotRaf = 0;
	let spotX = 0;
	let spotY = 0;

	function snapshot(): BackgroundSnapshot {
		return {
			reducedMotionMedia: motionQuery?.matches ?? false,
			dataMotionReduced: root.dataset.motion === "reduced",
			saveData: nav.connection?.saveData === true,
			deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
			hardwareConcurrency: typeof nav.hardwareConcurrency === "number"
				? nav.hardwareConcurrency
				: null,
			finePointer: pointerQuery?.matches ?? false,
			forcedColors: forcedQuery?.matches ?? false,
			webgl2,
			failure,
			intersecting,
			hidden: document.hidden,
			force,
		};
	}

	// #region Reflection
	function reflect(): void {
		const live = verdict.mode === "webgl" && glLive;
		reflectOn.dataset.lpBg = live ? "webgl" : "static";
		const reason = live ? null : verdict.reason ?? (glLost ? "context-lost" : "pending");
		if (reason) reflectOn.dataset.lpBgReason = reason;
		else delete reflectOn.dataset.lpBgReason;
		if (verdict.pause) reflectOn.dataset.lpBgPaused = verdict.pause;
		else delete reflectOn.dataset.lpBgPaused;
	}
	// #endregion

	// #region Spotlight
	const applySpot = () => {
		spotRaf = 0;
		const box = host.getBoundingClientRect();
		host.style.setProperty("--lp-spot-x", `${Math.round(spotX - box.left)}px`);
		host.style.setProperty("--lp-spot-y", `${Math.round(spotY - box.top)}px`);
	};
	const onSpotMove = (event: PointerEvent) => {
		if (event.pointerType === "touch") return;
		spotX = event.clientX;
		spotY = event.clientY;
		if (!spotRaf) spotRaf = requestAnimationFrame(applySpot);
	};

	/** `on` follows the pointer; `paused` keeps the last position; `off` returns to the SSR position. */
	function setSpot(next: "off" | "paused" | "on"): void {
		if (next === spot) return;
		if (spot === "on") globalThis.removeEventListener("pointermove", onSpotMove);
		if (spotRaf) cancelAnimationFrame(spotRaf);
		spotRaf = 0;
		spot = next;
		if (next === "on") {
			globalThis.addEventListener("pointermove", onSpotMove, { passive: true });
			host.dataset.lpSpot = "on";
		} else {
			delete host.dataset.lpSpot;
		}
		if (next === "off") {
			host.style.removeProperty("--lp-spot-x");
			host.style.removeProperty("--lp-spot-y");
		}
	}
	// #endregion

	// #region Quiet zones
	function relative(r: DOMRect, box: DOMRect): ZoneRect {
		return {
			x0: r.left - box.left,
			y0: r.top - box.top,
			x1: r.right - box.left,
			y1: r.bottom - box.top,
		};
	}

	/**
	 * The band the header pill covers while it can be transparent: its own width, from its resting
	 * place (`--lp-header-inset` below the top of `.lp-root`) down through the scroll band in which it
	 * stays transparent, so its text never sits on a full-alpha node (`flows/LANDING.md` §3.3).
	 */
	function headerZone(box: DOMRect): ZoneRect | null {
		if (!shell || !header || !headerQuery?.matches) return null;
		const r = header.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return null;
		const top = shell.getBoundingClientRect().top - box.top +
			readLength(header, "--lp-header-inset");
		return {
			x0: r.left - box.left,
			y0: top,
			x1: r.right - box.left,
			y1: top + r.height + HEADER_TOP_BAND_PX,
		};
	}

	const measureZones = () => {
		zonesRaf = 0;
		if (stopped) return;
		const box = host.getBoundingClientRect();
		if (box.width === 0 || box.height === 0) return;
		const copy: ZoneRect[] = [];
		const halo: ZoneRect[] = [];
		const pill = headerZone(box);
		if (pill) copy.push(pill);
		for (const el of hero.querySelectorAll<HTMLElement>(HALO_SELECTOR)) {
			if (el.closest(SKIP_SELECTOR)) continue;
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) halo.push(relative(r, box));
		}
		for (const el of hero.querySelectorAll<HTMLElement>(COPY_SELECTOR)) {
			if (el.closest(SKIP_SELECTOR)) continue;
			const r = el.getBoundingClientRect();
			if (r.width > 0 && r.height > 0) copy.push(relative(r, box));
		}
		const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
		const range = document.createRange();
		let runs = 0;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const parent = n.parentElement;
			if (!n.nodeValue?.trim() || !parent || parent.closest(`${SKIP_SELECTOR}, ${HALO_SELECTOR}`)) {
				continue;
			}
			range.selectNodeContents(n);
			const r = range.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (runs === MAX_TEXT_RUNS) {
				copy.length = 0;
				copy.push({ x0: 0, y0: 0, x1: box.width, y1: box.height });
				break;
			}
			runs += 1;
			copy.push(relative(r, box));
		}
		const next = buildZones({
			copy,
			halo,
			haloBlur: readLength(host, "--lp-halo-blur"),
			width: box.width,
			height: box.height,
		});
		const key = JSON.stringify(next.map((z) => [z.kind, z.x0, z.y0, z.x1, z.y1].map(String)));
		if (key === zonesKey) return;
		zonesKey = key;
		zones = next;
		publishZones(zones);
		gl?.setZones(zones);
	};

	function queueZones(): void {
		if (!zonesRaf && !stopped) zonesRaf = requestAnimationFrame(measureZones);
	}
	// #endregion

	// #region WebGL
	function teardownGL(): void {
		cancelWait?.();
		cancelWait = null;
		gl?.destroy();
		gl = null;
		glPhase = "none";
		glLive = false;
		glLost = false;
		delete host.dataset.lpGl;
	}

	const glCallbacks = {
		onLive() {
			glLive = true;
			glLost = false;
			host.dataset.lpGl = "live";
			reflect();
		},
		onLost() {
			glLive = false;
			glLost = true;
			delete host.dataset.lpGl;
			reflect();
		},
		onFail(reason: BackgroundFailure) {
			failure = reason;
			teardownGL();
			evaluate();
		},
	};

	function mountGL(): void {
		cancelWait = null;
		const now = decideBackground(snapshot());
		if (stopped || now.mode !== "webgl" || now.pause) {
			glPhase = "none";
			return;
		}
		glPhase = "loading";
		import("../core/constellation-gl.ts").then((mod) => {
			if (stopped || glPhase !== "loading") return;
			if (decideBackground(snapshot()).mode !== "webgl") {
				glPhase = "none";
				return;
			}
			const result = mod.mountConstellation(host, {
				...glCallbacks,
				zones,
				allowSoftware: force === "webgl",
			});
			if (!result.ok) {
				glPhase = "none";
				if (result.reason === "no-webgl") webgl2 = false;
				else failure = "no-tokens";
			} else {
				webgl2 = true;
				gl = result.handle;
				glPhase = "mounted";
			}
			evaluate();
		}).catch(() => {
			glPhase = "none";
			failure = "render-error";
			evaluate();
		});
	}

	/** Wait for first paint, then for an idle period, before the WebGL chunk is even requested. */
	function scheduleGL(): void {
		glPhase = "waiting";
		const frame = requestAnimationFrame(() => {
			if (typeof globalThis.requestIdleCallback === "function") {
				const id = globalThis.requestIdleCallback(mountGL, { timeout: IDLE_TIMEOUT_MS });
				cancelWait = () => globalThis.cancelIdleCallback(id);
			} else {
				const id = setTimeout(mountGL, IDLE_FALLBACK_MS);
				cancelWait = () => clearTimeout(id);
			}
		});
		cancelWait = () => cancelAnimationFrame(frame);
	}
	// #endregion

	// #region Decisions
	function evaluate(): void {
		if (stopped) return;
		verdict = decideBackground(snapshot());
		setSpot(verdict.mode === "spotlight" ? (verdict.pause ? "paused" : "on") : "off");
		if (verdict.mode !== "webgl") teardownGL();
		else if (gl) gl.setRunning(verdict.pause === null);
		else if (glPhase === "none" && verdict.pause === null) scheduleGL();
		reflect();
	}
	// #endregion

	// #region Listeners
	const onRootMutation = (records: MutationRecord[]) => {
		if (
			records.some((r) => r.attributeName === "data-theme" || r.attributeName === "data-contrast")
		) {
			gl?.refreshPalette();
		}
		queueZones();
		evaluate();
	};
	const onHeroMutation = (records: MutationRecord[]) => {
		const relevant = records.some((r) => {
			const el = r.target instanceof Element ? r.target : r.target.parentElement;
			return !el?.closest(SKIP_SELECTOR);
		});
		if (relevant) queueZones();
	};
	const onContrast = () => {
		gl?.refreshPalette();
		queueZones();
	};
	const onIntersect = (entries: IntersectionObserverEntry[]) => {
		const last = entries[entries.length - 1];
		if (!last) return;
		intersecting = last.isIntersecting;
		evaluate();
	};
	const onDevSeam = () => {
		const next = devForce();
		if (next === force) return;
		force = next;
		if (force === "webgl") {
			failure = null;
			if (webgl2 === false && typeof WebGL2RenderingContext === "function") webgl2 = null;
		}
		teardownGL();
		evaluate();
	};

	const rootObserver = new MutationObserver(onRootMutation);
	rootObserver.observe(root, { attributes: true, attributeFilter: ROOT_ATTRIBUTES });
	const heroObserver = new MutationObserver(onHeroMutation);
	heroObserver.observe(hero, { childList: true, subtree: true, characterData: true });
	const sizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(queueZones) : null;
	sizeObserver?.observe(hero);
	if (header) sizeObserver?.observe(header);
	const viewObserver = typeof IntersectionObserver === "function"
		? new IntersectionObserver(onIntersect)
		: null;
	if (viewObserver) viewObserver.observe(host);
	else intersecting = true;

	motionQuery?.addEventListener?.("change", evaluate);
	pointerQuery?.addEventListener?.("change", evaluate);
	forcedQuery?.addEventListener?.("change", evaluate);
	contrastQuery?.addEventListener?.("change", onContrast);
	headerQuery?.addEventListener?.("change", queueZones);
	document.addEventListener("visibilitychange", evaluate);
	nav.connection?.addEventListener?.("change", evaluate);
	const unsubscribeDev = subscribeDevSeam(onDevSeam);
	document.fonts?.ready.then(queueZones).catch(() => {});
	// #endregion

	queueZones();
	evaluate();

	return () => {
		if (stopped) return;
		stopped = true;
		teardownGL();
		setSpot("off");
		if (zonesRaf) cancelAnimationFrame(zonesRaf);
		zonesRaf = 0;
		rootObserver.disconnect();
		heroObserver.disconnect();
		sizeObserver?.disconnect();
		viewObserver?.disconnect();
		motionQuery?.removeEventListener?.("change", evaluate);
		pointerQuery?.removeEventListener?.("change", evaluate);
		forcedQuery?.removeEventListener?.("change", evaluate);
		contrastQuery?.removeEventListener?.("change", onContrast);
		headerQuery?.removeEventListener?.("change", queueZones);
		document.removeEventListener("visibilitychange", evaluate);
		nav.connection?.removeEventListener?.("change", evaluate);
		unsubscribeDev();
		delete reflectOn.dataset.lpBg;
		delete reflectOn.dataset.lpBgReason;
		delete reflectOn.dataset.lpBgPaused;
	};
}
// #endregion

// #region Island
/**
 * LandingBackground — the hero's background (`flows/LANDING.md` §2.7, §3.6, §7; Decisions #280,
 * #284). The server renders {@link BackgroundFallback}: grid, grain, a still spotlight and the static
 * SVG constellation, the LCP-safe first paint that needs no JavaScript.
 *
 * On the client the gate (`core/background-gate.ts`) picks the richest path the visitor allows and
 * re-decides whenever an input changes: either reduced-motion channel, forced colours, Save-Data,
 * memory, cores, the pointer, a WebGL2 context, the hero on screen, the tab visible. A fine pointer
 * moves the B7 spotlight (one write per frame, as custom properties on the background). A capable
 * device, after first paint and an idle period, imports the WebGL2 constellation as its own chunk
 * and crossfades it in; it pauses offscreen and in a hidden tab, and is torn down to the static
 * paint the moment reduced motion turns on or the context fails. The state is reflected as
 * `data-lp-bg="webgl|static"`, `data-lp-bg-reason` and `data-lp-bg-paused` on `.lp-root`.
 *
 * The text around it is measured into quiet zones (copy keeps the quiet alpha, the search halo is
 * cleared) that both the SVG mask and the shader honour. From `--bp-lg` the header pill's band is one
 * of them: the pill sheds its glass at the top of the page only once the zones exist
 * (`[data-lp-zones]`), so its text is held to the same quiet ground as the hero copy.
 */
export default function LandingBackground({ variant = "hero" }: LandingBackgroundProps) {
	const host = useRef<HTMLDivElement>(null);
	const zones = useSignal<readonly Zone[] | null>(null);

	// The background drives observers, a WebGL context and a frame loop: external DOM resources.
	useEffect(() => {
		const el = host.current;
		if (!el) return;
		return startBackground(el, (next) => {
			zones.value = next;
		});
	}, []);

	return <BackgroundFallback variant={variant} zones={zones.value} hostRef={host} />;
}
// #endregion
