import { ProjectAccess, ProjectStatus } from "@projective/types/projects";

/**
 * The development-only landing simulation (Decision #144, root CLAUDE.md §5).
 *
 * `/projects/[slug]` dispatches on the viewer's access and the project's status SERVER-side, so the
 * Dev Context Switcher cannot reach it through the `data-dev-*` seam the islands read. It writes this
 * cookie instead, and `resolveProjectAccess` honours it only under `IS_DEV` — the same shape as the
 * `pj.currency` cookie the server already reads to paint the first byte.
 *
 * Pure, and free of `IS_DEV`/`import.meta.env`, so it loads under `deno test`. Applying it, and
 * deciding whether it may apply at all, is the caller's job.
 */

// #region Contract
/** The cookie the Dev Context Switcher writes and `resolveProjectAccess` reads in development. */
export const LANDING_SIM_COOKIE = "pj.dev.landing";

/** The side of a bought service a simulation stands on (Decision #456). */
export type LandingServiceSide = "client" | "provider";

const SERVICE_SIDES: readonly LandingServiceSide[] = ["client", "provider"];

/** One simulation: any axis may be left alone (`null` = defer to the server's real value). */
export interface LandingSim {
	access: ProjectAccess | null;
	status: ProjectStatus | null;
	/** On a bought service only: its client's view or its provider's. */
	side: LandingServiceSide | null;
}

/** No simulation. */
export const NO_LANDING_SIM: LandingSim = { access: null, status: null, side: null };
// #endregion

// #region Codec
/**
 * The cookie value for a simulation, or `null` when it simulates nothing (the cookie is then removed
 * rather than written empty, so "no simulation" has one spelling).
 */
export function encodeLandingSim(sim: LandingSim): string | null {
	const params = new URLSearchParams();
	if (sim.access) params.set("access", sim.access);
	if (sim.status) params.set("status", sim.status);
	if (sim.side) params.set("side", sim.side);
	const value = params.toString();
	return value.length > 0 ? value : null;
}

/**
 * Read a cookie value back. Anything unrecognised — a hand-edited cookie, a value from an older build
 * — is ignored axis by axis rather than trusted, so a typo can never invent an access level.
 */
export function parseLandingSim(raw: string | null | undefined): LandingSim {
	if (!raw) return NO_LANDING_SIM;
	const params = new URLSearchParams(raw);
	const access = ProjectAccess.safeParse(params.get("access"));
	const status = ProjectStatus.safeParse(params.get("status"));
	const side = SERVICE_SIDES.find((s) => s === params.get("side")) ?? null;
	return {
		access: access.success ? access.data : null,
		status: status.success ? status.data : null,
		side,
	};
}

/** Whether a simulation changes anything. */
export function isLandingSimActive(sim: LandingSim): boolean {
	return sim.access !== null || sim.status !== null || sim.side !== null;
}

/**
 * How a simulated side of a bought service stands toward it (Decision #427): its client is on the
 * owner side and never configures it, its provider is a participant who does. `null` off a service or
 * without a side, so the caller keeps the server's answer.
 */
export function serviceSideAccess(
	sim: LandingSim,
	service: boolean,
): { access: ProjectAccess; canConfigure: boolean } | null {
	if (!service || sim.side === null) return null;
	return sim.side === "client"
		? { access: "owner", canConfigure: false }
		: { access: "participant", canConfigure: true };
}
// #endregion
