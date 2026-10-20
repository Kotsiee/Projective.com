/// <reference lib="dom" />
import "../styles/lp-background.css";
import { useEffect, useRef } from "preact/hooks";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { BackgroundFallback, type BackgroundVariant } from "../components/BackgroundFallback.tsx";
import {
	type BackgroundForce,
	type BackgroundSnapshot,
	type BackgroundVerdict,
	decideBackground,
	parseBackgroundForce,
} from "../core/background-gate.ts";

// #region Contract
/** Props for {@link LandingBackground}. */
export interface LandingBackgroundProps {
	/**
	 * Which background: the hero's (the default), or the final call to action's. Each instance runs
	 * its own gate over its own region, so only the one on screen follows the pointer.
	 */
	variant?: BackgroundVariant;
}

/** The non-standard navigator hints the gate reads, where the browser exposes them. */
interface NavigatorHints {
	connection?: EventTarget & { saveData?: boolean };
	deviceMemory?: number;
}

/** The spotlight's resting place: the gate's verdict, held, or following the pointer. */
type SpotState = "off" | "paused" | "on";
// #endregion

// #region Environment
/** The developer's `landingBackground` choice; always `auto` in production, where the seam is inert. */
function devForce(): BackgroundForce {
	return parseBackgroundForce(readDevSeam()?.landingBackground);
}
// #endregion

// #region Controller
/**
 * Run a background for `host` (the `.lp-bg` element) until the returned stop function is called:
 * read the environment, ask the gate, and move the spotlight from its answer. Every listener and
 * observer is a stable function created here, so each is removed by identity on stop. The hero's
 * state is reflected on `.lp-root` (its documented hook); any other region's on its own host, so a
 * second background never overwrites the hero's.
 */
function startBackground(host: HTMLElement, variant: BackgroundVariant): () => void {
	const root = document.documentElement;
	const reflectOn = variant === "hero" ? host.closest<HTMLElement>(".lp-root") ?? host : host;
	const nav = navigator as Navigator & NavigatorHints;
	const query = (q: string) => globalThis.matchMedia?.(q) ?? null;
	const motionQuery = query("(prefers-reduced-motion: reduce)");
	const pointerQuery = query("(hover: hover) and (pointer: fine)");
	const forcedQuery = query("(forced-colors: active)");

	let stopped = false;
	let intersecting = false;
	let force = devForce();
	let verdict: BackgroundVerdict = decideBackground(snapshot());

	let spot: SpotState = "off";
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
			intersecting,
			hidden: document.hidden,
			force,
		};
	}

	// #region Reflection
	function reflect(): void {
		reflectOn.dataset.lpBg = verdict.mode;
		if (verdict.reason) reflectOn.dataset.lpBgReason = verdict.reason;
		else delete reflectOn.dataset.lpBgReason;
		if (verdict.pause) reflectOn.dataset.lpBgPaused = verdict.pause;
		else delete reflectOn.dataset.lpBgPaused;
	}
	// #endregion

	// #region Spotlight
	/**
	 * Write the pointer's position, and from the first real move mark the spotlight as led
	 * (`data-lp-spot="on"`), which is what draws the lit grid: at rest the paint matches the static
	 * one, the grid kept to its corner.
	 */
	const applySpot = () => {
		spotRaf = 0;
		const box = host.getBoundingClientRect();
		host.style.setProperty("--lp-spot-x", `${Math.round(spotX - box.left)}px`);
		host.style.setProperty("--lp-spot-y", `${Math.round(spotY - box.top)}px`);
		if (host.dataset.lpSpot !== "on") host.dataset.lpSpot = "on";
	};
	const onSpotMove = (event: PointerEvent) => {
		if (event.pointerType === "touch") return;
		spotX = event.clientX;
		spotY = event.clientY;
		if (!spotRaf) spotRaf = requestAnimationFrame(applySpot);
	};

	/**
	 * `on` listens for the pointer (the lit grid waits for its first move); `paused` keeps the last
	 * position; `off` returns to the SSR position. Leaving `on` hides the lit grid again.
	 */
	function setSpot(next: SpotState): void {
		if (next === spot) return;
		if (spot === "on") globalThis.removeEventListener("pointermove", onSpotMove);
		if (spotRaf) cancelAnimationFrame(spotRaf);
		spotRaf = 0;
		spot = next;
		if (next === "on") {
			globalThis.addEventListener("pointermove", onSpotMove, { passive: true });
		} else {
			delete host.dataset.lpSpot;
		}
		if (next === "off") {
			host.style.removeProperty("--lp-spot-x");
			host.style.removeProperty("--lp-spot-y");
		}
	}
	// #endregion

	// #region Decisions
	function evaluate(): void {
		if (stopped) return;
		verdict = decideBackground(snapshot());
		setSpot(verdict.mode === "spotlight" ? (verdict.pause ? "paused" : "on") : "off");
		reflect();
	}
	// #endregion

	// #region Listeners
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
		evaluate();
	};

	const rootObserver = new MutationObserver(evaluate);
	rootObserver.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
	const viewObserver = typeof IntersectionObserver === "function"
		? new IntersectionObserver(onIntersect)
		: null;
	if (viewObserver) viewObserver.observe(host);
	else intersecting = true;

	motionQuery?.addEventListener?.("change", evaluate);
	pointerQuery?.addEventListener?.("change", evaluate);
	forcedQuery?.addEventListener?.("change", evaluate);
	document.addEventListener("visibilitychange", evaluate);
	nav.connection?.addEventListener?.("change", evaluate);
	const unsubscribeDev = subscribeDevSeam(onDevSeam);
	// #endregion

	evaluate();

	return () => {
		if (stopped) return;
		stopped = true;
		setSpot("off");
		rootObserver.disconnect();
		viewObserver?.disconnect();
		motionQuery?.removeEventListener?.("change", evaluate);
		pointerQuery?.removeEventListener?.("change", evaluate);
		forcedQuery?.removeEventListener?.("change", evaluate);
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
 * #288). The server renders {@link BackgroundFallback}: the solid canvas, the B7 grid with its
 * spotlight at the SSR position and the B10 grain — the LCP-safe first paint that needs no
 * JavaScript, and the whole picture under the gate's `static` verdict.
 *
 * On the client the gate (`core/background-gate.ts`) re-decides whenever an input changes — either
 * reduced-motion channel, forced colours, the pointer, Save-Data, the hero on screen, the tab
 * visible — and on a capable fine-pointer device the spotlight follows the pointer: one write per
 * animation frame, as custom properties on the background, moved by `translate` alone; the lit grid
 * it carries is drawn from the first pointer move, so at rest the hero matches its still paint. It
 * holds still offscreen and in a hidden tab, and returns to its SSR position the moment reduced
 * motion turns on. The state is reflected as `data-lp-bg="spotlight|static"`, `data-lp-bg-reason`
 * and `data-lp-bg-paused` on `.lp-root`.
 *
 * The final call to action mounts a second instance (`variant="final"`, §2.3 note 22): the same
 * gate over its own region, so the spotlight follows the pointer only in the one on screen, and its
 * state reflected on its own host.
 */
export default function LandingBackground({ variant = "hero" }: LandingBackgroundProps) {
	const host = useRef<HTMLDivElement>(null);

	// The background drives observers and a pointer listener: external DOM resources.
	useEffect(() => {
		const el = host.current;
		if (!el) return;
		return startBackground(el, variant);
	}, []);

	return <BackgroundFallback variant={variant} hostRef={host} />;
}
// #endregion
