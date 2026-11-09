import { useSignal } from "@preact/signals";
import type { ReadonlySignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import type { FileAccessSim } from "../core/access-draft.ts";

/**
 * The dev Context Switcher's `fileAccess` axis (Decision #402): the standing the Access tab draws in
 * place of the server's. Read after mount, so the server's paint and the first client paint agree;
 * always `auto` in production, where the seam is never written.
 */
export function useFileAccessSim(): ReadonlySignal<FileAccessSim> {
	const sim = useSignal<FileAccessSim>("auto");
	useEffect(() => {
		sim.value = readDevSeam()?.fileAccess ?? "auto";
		return subscribeDevSeam((seam) => {
			sim.value = seam?.fileAccess ?? "auto";
		});
	}, []);
	return sim;
}
