import { useEffect } from "preact/hooks";
import type { WebVital, WebVitalName, WebVitalsBatch } from "@projective/types/logging";
import { IS_DEV } from "@web/utils/dev.ts";
import { logger } from "@web/utils/logger.ts";
import { inpFrom, LayoutShiftWindows, rateVital } from "../core/web-vitals-model.ts";

const VITALS_URL = "/api/logs/vitals";
/** Discrete events shorter than this are not reported by the browser and cannot set INP. */
const EVENT_DURATION_THRESHOLD = 40;

interface LayoutShiftEntry extends PerformanceEntry {
	value: number;
	hadRecentInput: boolean;
}

interface InteractionEntry extends PerformanceEntry {
	interactionId?: number;
}

/**
 * WebVitalsBridge — measures the page's Core Web Vitals (CLS, LCP, INP) with the browser's own
 * `PerformanceObserver` and reports them once, when the page is first hidden. Renders nothing.
 *
 * Production beacons the samples to `POST /api/logs/vitals` (stored as `metric` rows in
 * `ops.log_entries`); development writes them to the Dev Tools log inspector instead, mirroring
 * how the logger itself never calls the server in development. An entry type the browser does not
 * support is simply not measured.
 */
export default function WebVitalsBridge(): null {
	useEffect(() => measure(), []);
	return null;
}

function observe(
	type: string,
	onEntries: (entries: PerformanceEntry[]) => void,
	extra: Record<string, number> = {},
): PerformanceObserver | null {
	if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return null;
	const observer = new PerformanceObserver((list) => onEntries(list.getEntries()));
	observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
	return observer;
}

function navigationType(): string | undefined {
	const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
	return nav?.type;
}

function measure(): () => void {
	const pageId = crypto.randomUUID();
	const hiddenAtStart = document.visibilityState === "hidden";
	const cls = new LayoutShiftWindows();
	const interactions = new Map<number, number>();
	let lcp: number | null = null;
	let lcpFinal = false;
	let reported = false;

	const observers = [
		observe("largest-contentful-paint", (entries) => {
			if (lcpFinal || hiddenAtStart) return;
			const last = entries.at(-1);
			if (last) lcp = last.startTime;
		}),
		observe("layout-shift", (entries) => {
			for (const entry of entries as LayoutShiftEntry[]) {
				if (!entry.hadRecentInput) cls.add(entry.value, entry.startTime);
			}
		}),
		observe("event", (entries) => {
			for (const entry of entries as InteractionEntry[]) {
				if (!entry.interactionId) continue;
				const worst = interactions.get(entry.interactionId) ?? 0;
				interactions.set(entry.interactionId, Math.max(worst, entry.duration));
			}
		}, { durationThreshold: EVENT_DURATION_THRESHOLD }),
	];

	const finaliseLcp = () => {
		lcpFinal = true;
	};

	const report = () => {
		if (reported) return;
		reported = true;
		finaliseLcp();
		const at = Date.now();
		const nav = navigationType();
		const values: Array<[WebVitalName, number | null]> = [
			["LCP", lcp],
			["CLS", PerformanceObserver.supportedEntryTypes?.includes("layout-shift") ? cls.value : null],
			["INP", inpFrom([...interactions.values()])],
		];
		const vitals: WebVital[] = values
			.filter((pair): pair is [WebVitalName, number] => pair[1] !== null)
			.map(([name, value]) => ({
				name,
				value,
				rating: rateVital(name, value),
				id: pageId,
				navigationType: nav,
				at,
			}));
		if (vitals.length === 0) return;

		if (IS_DEV) {
			for (const v of vitals) logger.info(`[web-vitals] ${v.name} ${v.value} (${v.rating})`, v);
			return;
		}
		const body: WebVitalsBatch = {
			vitals,
			meta: { path: location.pathname, userAgent: navigator.userAgent },
		};
		const json = JSON.stringify(body);
		if (navigator.sendBeacon(VITALS_URL, new Blob([json], { type: "application/json" }))) return;
		fetch(VITALS_URL, {
			method: "POST",
			body: json,
			keepalive: true,
			headers: { "content-type": "application/json", "x-pj-background": "1" },
		}).catch((error: unknown) =>
			logger.warn("Web vitals could not be sent", {
				reason: error instanceof Error ? error.message : String(error),
			})
		);
	};

	const onHidden = () => {
		if (document.visibilityState === "hidden") report();
	};

	globalThis.addEventListener("keydown", finaliseLcp, { once: true, capture: true });
	globalThis.addEventListener("pointerdown", finaliseLcp, { once: true, capture: true });
	document.addEventListener("visibilitychange", onHidden);
	globalThis.addEventListener("pagehide", report);

	return () => {
		for (const observer of observers) observer?.disconnect();
		globalThis.removeEventListener("keydown", finaliseLcp, { capture: true });
		globalThis.removeEventListener("pointerdown", finaliseLcp, { capture: true });
		document.removeEventListener("visibilitychange", onHidden);
		globalThis.removeEventListener("pagehide", report);
	};
}
