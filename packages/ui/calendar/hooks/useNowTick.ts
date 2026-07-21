/**
 * @projective/ui/calendar — a live "now" ticker for the current-time indicator. SSR-safe: the signal
 * seeds with a stable `initial` (so the server render and first client paint agree — no hydration
 * drift), then `mounted` flips and the real wall clock takes over in an effect, re-ticking on an
 * interval. Mirrors the profile `LocalTimeClock` island's no-mismatch pattern.
 */
import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

export interface NowTick {
	/** Current epoch ms — the seed value until mounted, then the live clock. */
	now: Signal<number>;
	/** False during SSR / first paint; true once the client effect has run. */
	mounted: Signal<boolean>;
}

/** Tick the current time every `intervalMs` (default 30s), starting from `initial`. */
export function useNowTick(intervalMs = 30_000, initial = 0): NowTick {
	const now = useSignal(initial);
	const mounted = useSignal(false);

	useEffect(() => {
		mounted.value = true;
		now.value = Date.now();
		const id = setInterval(() => {
			now.value = Date.now();
		}, intervalMs);
		return () => clearInterval(id);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [intervalMs]);

	return { now, mounted };
}
