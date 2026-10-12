import {
	DiscoveryActivitySim,
	type DiscoverySim,
	DiscoveryViewerSim,
	NO_DISCOVERY_SIM,
} from "@projective/types/explore";

/**
 * The development-only discovery cold-start simulation (root CLAUDE.md §5).
 *
 * `/explore`'s personal and trending rails are composed SERVER-side, so the Dev Context Switcher
 * cannot reach them through the `data-dev-*` seam the islands read. It writes this cookie instead —
 * the same channel as `pj.dev.landing` (`features/projects/core/landing-sim.ts`) — and the route
 * forwards it only under `IS_DEV`, where `ExploreBackendService.home` gates it again on `DENO_ENV`.
 *
 * Pure, and free of `IS_DEV`/`import.meta.env`, so it loads under `deno test`.
 */

// #region Contract
/** The cookie the Dev Context Switcher writes and `/explore` reads in development. */
export const DISCOVERY_SIM_COOKIE = "pj.dev.discovery";
// #endregion

// #region Codec
/**
 * The cookie value for a simulation, or `null` when it simulates nothing (the cookie is then removed
 * rather than written empty, so "no simulation" has one spelling).
 */
export function encodeDiscoverySim(sim: DiscoverySim): string | null {
	const params = new URLSearchParams();
	if (sim.viewer !== "auto") params.set("viewer", sim.viewer);
	if (sim.activity !== "auto") params.set("activity", sim.activity);
	const value = params.toString();
	return value.length > 0 ? value : null;
}

/**
 * Read a cookie value back. Anything unrecognised — a hand-edited cookie, a value from an older build —
 * falls back to `auto` axis by axis rather than being trusted.
 */
export function parseDiscoverySim(raw: string | null | undefined): DiscoverySim {
	if (!raw) return NO_DISCOVERY_SIM;
	const params = new URLSearchParams(raw);
	const viewer = DiscoveryViewerSim.safeParse(params.get("viewer"));
	const activity = DiscoveryActivitySim.safeParse(params.get("activity"));
	return {
		viewer: viewer.success ? viewer.data : "auto",
		activity: activity.success ? activity.data : "auto",
	};
}
// #endregion
