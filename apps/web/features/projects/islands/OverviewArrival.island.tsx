import { useEffect } from "preact/hooks";
import "../styles/project-dashboard.css";
import type { OverviewChange } from "../types/projects-types.ts";

/** Props for {@link OverviewArrival}. */
export interface OverviewArrivalProps {
	/** The Overview regions that changed since the viewer's last visit. */
	changes: readonly OverviewChange[];
}

const ARRIVAL_CLASS = "pjd-arrival";

function highlightMs(): number {
	const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-highlight").trim();
	const ms = raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
	return Number.isFinite(ms) ? ms : 0;
}

/**
 * OverviewArrival — on arriving at the Overview with unseen changes, briefly highlights the regions
 * they landed in (`[data-pjd-region]`: the title, the status line, the stage run), then removes the
 * class. The animation's own end clears it; a timer at `--dur-highlight` clears it when no animation
 * runs (either reduced-motion channel). Renders nothing.
 */
export default function OverviewArrival({ changes }: OverviewArrivalProps): null {
	useEffect(() => {
		if (changes.length === 0) return;
		const nodes = changes.flatMap((change) => [
			...document.querySelectorAll<HTMLElement>(`.pjd [data-pjd-region="${change}"]`),
		]);
		if (nodes.length === 0) return;

		const clear = (node: HTMLElement) => node.classList.remove(ARRIVAL_CLASS);
		const onEnd = (event: AnimationEvent) => {
			if (event.target instanceof HTMLElement) clear(event.target);
		};
		for (const node of nodes) {
			node.classList.add(ARRIVAL_CLASS);
			node.addEventListener("animationend", onEnd);
		}
		const timer = setTimeout(() => nodes.forEach(clear), highlightMs());
		return () => {
			clearTimeout(timer);
			for (const node of nodes) {
				node.removeEventListener("animationend", onEnd);
				clear(node);
			}
		};
	}, []);
	return null;
}
