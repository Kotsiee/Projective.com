import { type ReadonlySignal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import type { VerifyPollSimulation } from "../core/verify-poll.ts";

/**
 * The Dev Context Switcher's `emailConfirmation` position for `/verify`'s poll. Seeded `auto` so
 * hydration matches the server; inert in production, where the seam is absent.
 */
export function useVerifyPollSimulation(): ReadonlySignal<VerifyPollSimulation> {
	const state = useSignal<VerifyPollSimulation>("auto");
	useEffect(() => {
		const apply = (seam: DevSeamState | null): void => {
			state.value = seam?.emailConfirmation ?? "auto";
		};
		apply(readDevSeam());
		return subscribeDevSeam(apply);
	}, []);
	return state;
}
