import { type FilesSim, filesSimIsEmpty } from "../types/file-types.ts";
import { IS_DEV } from "@web/utils/dev.ts";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";

/**
 * files-seam — the bridge between the CLIENT-side Dev Context Switcher and this SERVER-derived
 * surface.
 *
 * The switcher publishes its simulated state as `<html data-dev-*>` attributes, which the server
 * cannot see. Every one of the six files axes changes data the SERVER produced — which provider a
 * mount came from, whether that connection is healthy, how full the allowance is, what privacy scope
 * the assets carry, what a link scan concluded, what the duplicate index found — so reading the seam
 * client-side would move nothing on screen. The axes therefore travel as validated QUERY PARAMS on
 * the read and the fat service applies them as an overlay: the same mechanism `/wallet` (Decision
 * #55) and `/teams` (Decision #61) use, for the same reason.
 *
 * Two halves, deliberately separated:
 *   - {@link simFromSeam} / {@link simToQuery} run on the CLIENT and are gated on {@link IS_DEV}, so
 *     the whole thing tree-shakes out of production and no query param is ever appended there.
 *   - {@link simFromParams} runs on the SERVER and validates against the SSOT, so a hand-crafted URL
 *     cannot inject an unvalidated shape.
 *
 * Reading or sending the seam grants **no access**. It only changes what the developer's own request
 * is answered with; RLS and the route guard remain the real gates, and the live path ignores the
 * overlay entirely.
 */

// #region Transport (re-exported from the SSOT — never reimplemented)
/**
 * The parse and the serialise halves live in `@projective/types/files/sim.ts` and are re-exported
 * here so a consumer has one seam import.
 *
 * They are NOT reimplemented locally the way `workspace-seam.ts` implements its own: this domain's
 * SSOT already ships them, and a second parser for the same query params is a second place for the
 * param NAMES to drift — at which point the switcher moves an axis the server never reads and the
 * failure looks like the fixture being wrong.
 */
export { simFromParams, simToQuery } from "../types/file-types.ts";
// #endregion

// #region Server side
/**
 * Carry an active simulation across a server-issued redirect.
 *
 * Without this, any redirect the hub performs — a scope that resolves elsewhere, a share slug that
 * lands on the library, a folder that has moved — drops the simulation on the way, so the developer
 * arrives back as their real self and the axis they were exercising appears not to work.
 *
 * Only the `sim*` params are forwarded; nothing else about the source URL is inherited, so a redirect
 * cannot smuggle an unrelated query string into its destination.
 */
export function preserveSim(from: URL, to: string): string {
	const carried = new URLSearchParams();
	for (const [key, value] of from.searchParams) {
		if (key.startsWith("sim")) carried.set(key, value);
	}
	const q = carried.toString();
	if (!q) return to;
	return `${to}${to.includes("?") ? "&" : "?"}${q}`;
}
// #endregion

// #region Client side
/**
 * The simulation overlay implied by the active dev seam, or `undefined` in production, without a DOM,
 * or when no axis is overridden.
 *
 * Only axes that DIFFER from their switcher default are sent. An overlay that restated the defaults
 * would make every request look simulated and hide which axis is actually being exercised — and, on
 * this surface specifically, would pin the quota band to `healthy` for a library that is genuinely
 * full.
 *
 * Two members are translated rather than passed through, because the switcher's vocabulary and the
 * SSOT's are not the same set:
 *
 *  - the seam's **`near_limit`** is the panel's single "approaching the ceiling" option, and it maps
 *    to the SSOT's **`critical`** (≥90%) rather than `warning` (≥75%) — `critical` is the loudest
 *    band before refusal and therefore the one a developer reaches for the option to reach. The
 *    SSOT's `warning` band is consequently NOT reachable from the switcher (flagged).
 *  - the seam's **`none`** provider and **`none`** dedup state are the DEFAULTS and are suppressed
 *    rather than mapped. `none` means "no connector" and "nothing matched", which are precisely the
 *    real projection — the SSOT's `supabase` and `new` say the same thing, and sending them would
 *    mark an un-simulated request as simulated.
 */
export function simFromSeam(state?: DevSeamState | null): FilesSim | undefined {
	if (!IS_DEV) return undefined;
	const seam = state ?? readDevSeam();
	if (!seam) return undefined;

	const sim: FilesSim = {};

	if (seam.storageProvider !== "none") sim.storageProvider = seam.storageProvider;
	if (seam.connectionState !== "disconnected") sim.connectionState = seam.connectionState;
	if (seam.storageQuota !== "healthy") {
		sim.storageQuota = seam.storageQuota === "near_limit" ? "critical" : seam.storageQuota;
	}
	if (seam.assetVisibility !== "private") sim.assetVisibility = seam.assetVisibility;
	if (seam.linkScan !== "safe") sim.linkScan = seam.linkScan;
	if (seam.dedupState !== "none") sim.dedupState = seam.dedupState;

	return filesSimIsEmpty(sim) ? undefined : sim;
}

/**
 * Subscribe to seam changes, receiving the overlay each change implies.
 *
 * Returns an unsubscribe function; a no-op returning a no-op in production, so no listener is
 * retained there. Consumers **refetch** on each call — the axes are server-derived, so a re-render
 * alone would show the same data with a different label on it, which is worse than not reacting at
 * all.
 */
export function subscribeFilesSim(fn: (sim: FilesSim | undefined) => void): () => void {
	if (!IS_DEV) return () => {};
	return subscribeDevSeam((state) => fn(simFromSeam(state)));
}
// #endregion
