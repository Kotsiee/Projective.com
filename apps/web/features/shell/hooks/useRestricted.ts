import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";

/**
 * Whether the viewer is a restricted (13–17) account (Decision #192), for an island that holds only
 * the SSR answer: `base` until hydration, then the Dev Context Switcher's Age axis whenever it is set,
 * so a simulated minor re-gates the island with no reload. Inert in production, where the seam is.
 */
export function useRestricted(base: boolean): boolean {
	const seam = useSignal<DevSeamState | null>(null);
	useEffect(() => {
		seam.value = readDevSeam();
		return subscribeDevSeam((next) => {
			seam.value = next;
		});
	}, []);
	const axis = seam.value?.ageRestriction;
	return axis && axis !== "auto" ? axis === "minor" : base;
}
