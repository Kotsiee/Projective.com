import { useEffect } from "preact/hooks";
import { IS_DEV } from "@web/utils/dev.ts";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import type { ServiceSim } from "@projective/types/services";

/**
 * booking-seam — the client bridge from the Dev Context Switcher to the listing page's booking
 * surfaces.
 *
 * The switcher publishes its overrides as `<html data-dev-*>` attributes, which the SERVER cannot
 * see. Every axis these surfaces branch on changes data the server produced — whether this seller
 * takes discovery calls, how many cohort seats are left, whether this buyer already has a draft, how
 * much availability the grid finds — so reading the seam client-side would move nothing on screen.
 * The axes therefore travel as validated `sim*` query params on each read, and the fat service applies
 * them as an overlay: the mechanism `/wallet` (#55), `/teams` (#61), `/files` (#67) and `/checkout`
 * (#70) all use, for the same reason.
 *
 * Production safety: {@link readDevSeam} returns `null` there and every branch is gated on
 * {@link IS_DEV}, so the whole simulation half tree-shakes out and no `sim*` param is ever appended.
 * Sending the seam grants **no access** — RLS and the route guards remain the real gates, and the live
 * path ignores the overlay entirely.
 */

// #region Seam → simulation
/**
 * Map the dev seam's booking axes into a {@link ServiceSim}, or `undefined` when no override is active
 * (and always in production).
 *
 * Every field is passed through as-is. There is no "default" translation layer: an axis left on `auto`
 * is simply absent from the overlay, which is what makes the fat service fall back to its real
 * projection rather than to a simulated one that happens to look real.
 */
export function simFromSeam(seam: DevSeamState | null): ServiceSim | undefined {
	if (!IS_DEV || !seam) return undefined;
	const sim: ServiceSim = {};
	if (seam.callOffer !== "auto") sim.callOffer = seam.callOffer;
	if (seam.cohortCapacity !== "auto") sim.cohortCapacity = seam.cohortCapacity;
	if (seam.pipelineDraft !== "auto") sim.pipelineDraft = seam.pipelineDraft;
	if (seam.slotAvailability !== "auto") sim.availability = seam.slotAvailability;
	return Object.keys(sim).length > 0 ? sim : undefined;
}

/** The overlay for the current seam state, or `undefined`. Safe to call from anywhere. */
export function bookingSim(seam?: DevSeamState | null): ServiceSim | undefined {
	return simFromSeam(seam === undefined ? readDevSeam() : seam);
}
// #endregion

// #region Hook
/**
 * Track the seam and refetch when it changes.
 *
 * `onChange` fires ONCE on mount when an override is already active — the SSR paint never saw the
 * client seam, so the first byte is answering a question the developer has already changed — and then
 * on every subsequent change. It does NOT fire on mount when no override is active, because the SSR
 * paint is then already correct and a refetch would be a request that changes nothing.
 *
 * Inert in production: `readDevSeam` returns `null`, so the mount branch never fires and
 * `subscribeDevSeam` returns a no-op unsubscribe without registering a listener.
 */
export function useBookingSeam(onChange: (sim: ServiceSim | undefined) => void): void {
	useEffect(() => {
		let first = true;
		const apply = () => {
			const seam = readDevSeam();
			const sim = simFromSeam(seam);
			if (first) {
				first = false;
				if (seam) onChange(sim);
				return;
			}
			onChange(sim);
		};
		apply();
		return subscribeDevSeam(apply);
		// `onChange` is a stable closure at every call site (it reads signals rather than props), so it
		// is deliberately not a dependency: including it would re-subscribe on every render.
	}, []);
}
// #endregion
