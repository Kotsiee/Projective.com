import {
	simIsEmpty,
	type WorkspaceKind,
	type WorkspaceSim,
	WorkspaceSimSchema,
} from "@projective/types/workspace";
import { IS_DEV } from "@web/utils/dev.ts";
import { type DevSeamState, readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";

/**
 * workspace-seam — the bridge between the CLIENT-side Dev Context Switcher and this SERVER-derived
 * surface.
 *
 * The switcher publishes its simulated persona as `<html data-dev-*>` attributes, which the server
 * cannot see. Every axis on this surface (the viewer's role in the entity, their membership state, the
 * entity's verification, the acting flag, the roster's shape) changes data the server produced, so
 * simply reading the seam client-side would not move anything. The axes therefore travel as QUERY
 * PARAMS on the read, and the fat service applies them as an overlay — the same mechanism `/wallet`
 * uses (root CLAUDE.md Decision #55), for the same reason.
 *
 * Two halves, deliberately separated:
 *   - {@link simFromSeam} / {@link simToQuery} run on the CLIENT and are gated on {@link IS_DEV}, so the
 *     whole thing tree-shakes out of production and no query param is ever appended there.
 *   - {@link simFromParams} runs on the SERVER and validates against the SSOT, so a hand-crafted URL
 *     cannot inject an unvalidated shape.
 *
 * Reading or sending the seam grants **no access**: it only changes what the developer's own request is
 * answered with. RLS and the route guard remain the real gates, and the live path ignores the overlay
 * entirely.
 */

// #region Server side
/**
 * Parse a simulation overlay from a request's query string, or `undefined` when none was asked for.
 *
 * Validated through {@link WorkspaceSimSchema}, so an unknown value is dropped rather than trusted. A
 * failed parse yields `undefined` — the real projection — because a malformed simulation should show the
 * truth, not nothing.
 */
export function simFromParams(params: URLSearchParams): WorkspaceSim | undefined {
	const raw: Record<string, unknown> = {};
	const role = params.get("simRole");
	const membership = params.get("simMembership");
	const verification = params.get("simVerification");
	const acting = params.get("simActing");
	const roster = params.get("simRoster");

	if (role) raw.role = role;
	if (membership) raw.membership = membership;
	if (verification) raw.verification = verification;
	if (acting === "true" || acting === "false") raw.acting = acting === "true";
	if (roster) raw.roster = roster;

	if (Object.keys(raw).length === 0) return undefined;
	const parsed = WorkspaceSimSchema.safeParse(raw);
	if (!parsed.success) return undefined;
	return simIsEmpty(parsed.data) ? undefined : parsed.data;
}

/**
 * Carry an active simulation across a server-issued redirect.
 *
 * Without this, the capability gate bounces a simulated Member to their landing module and drops the
 * simulation on the way — so the developer lands back as their real self and the axis they were
 * exercising appears not to work. The redirect is the single most important thing to be able to
 * simulate here (it IS the "never 404 out of your own workspace" behaviour), so it has to survive it.
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
 * or when no override is active.
 *
 * Only the axes that actually differ from their defaults are sent. An overlay that restates the default
 * would make every request look simulated and hide which axis the developer is really exercising.
 */
export function simFromSeam(state?: DevSeamState | null): WorkspaceSim | undefined {
	if (!IS_DEV) return undefined;
	const seam = state ?? readDevSeam();
	if (!seam) return undefined;

	const sim: WorkspaceSim = {};
	if (seam.workspaceRole !== "admin") sim.role = seam.workspaceRole;
	if (seam.membershipState !== "active") sim.membership = seam.membershipState;
	if (seam.workspaceVerification !== "verified") {
		// The seam's `kyb_pending` is the switcher's label for the SSOT's `pending` state.
		sim.verification = seam.workspaceVerification === "kyb_pending"
			? "pending"
			: seam.workspaceVerification;
	}
	if (seam.actingContext) sim.acting = true;
	if (seam.rosterState !== "populated") sim.roster = seam.rosterState;

	return simIsEmpty(sim) ? undefined : sim;
}

/** The entity kind the seam is simulating, or `undefined` when the route's own kind should win. */
export function seamKind(state?: DevSeamState | null): WorkspaceKind | undefined {
	if (!IS_DEV) return undefined;
	const seam = state ?? readDevSeam();
	return seam ? seam.workspaceKind : undefined;
}

/**
 * Render an overlay as query params to append to a read. Returns `""` when there is nothing to
 * simulate, so a production request is byte-identical to one from before this seam existed.
 */
export function simToQuery(sim: WorkspaceSim | undefined): string {
	if (simIsEmpty(sim) || !sim) return "";
	const params = new URLSearchParams();
	if (sim.role) params.set("simRole", sim.role);
	if (sim.membership) params.set("simMembership", sim.membership);
	if (sim.verification) params.set("simVerification", sim.verification);
	if (sim.acting !== undefined) params.set("simActing", String(sim.acting));
	if (sim.roster) params.set("simRoster", sim.roster);
	const q = params.toString();
	return q ? `&${q}` : "";
}

/**
 * Subscribe to seam changes, receiving the overlay each change implies.
 *
 * Returns an unsubscribe function; a no-op returning a no-op in production, so no listener is retained
 * there. Consumers refetch on each call — the axes are server-derived, so a re-render alone would show
 * the same data with a different label on it, which is worse than not reacting at all.
 */
export function subscribeWorkspaceSim(
	fn: (sim: WorkspaceSim | undefined, kind: WorkspaceKind | undefined) => void,
): () => void {
	if (!IS_DEV) return () => {};
	return subscribeDevSeam((state) => fn(simFromSeam(state), seamKind(state)));
}
// #endregion
