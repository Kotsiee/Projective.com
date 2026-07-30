import type { UserContext } from "@projective/types/auth";
import type {
	WorkspaceDetail,
	WorkspaceKind,
	WorkspaceRoster,
	WorkspaceSim,
} from "@projective/types/workspace";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import {
	firstModuleFor,
	mayViewModule,
	type ModuleKey,
	modulesForViewer,
	type WorkspaceModule,
} from "./module-registry.tsx";

/**
 * workspace-ssr — the **server-only** bootstraps for the `/teams` and `/businesses` first paint.
 *
 * These call the fat {@link WorkspaceBackendService} **directly, with no HTTP hop**, so the roster, the
 * console, the lane's nav and the header band all ship in the initial byte; the islands then refine
 * through the thin {@link WorkspaceService}. Mirrors `catalogue/core/catalogue-ssr.ts` and
 * `projects/core/feed-ssr.ts`.
 *
 * **Never import this from an island.** It reaches `@server/services`, which would drag the backend
 * package into a client bundle and break the islands-are-dumb boundary (root CLAUDE.md §2). The `*-slot`
 * resolvers and route handlers are its only legitimate callers.
 */

// #region Empty projections
/**
 * The safe empty roster, minus its kind. A read that fails must still paint a real surface — the roster's
 * empty state is a genuine, designed screen that explains what an entity is and offers to create one, so
 * degrading to it is strictly better than an error page for a viewer who simply has no entities yet.
 *
 * `canCreate` stays `true` on the degraded path: creation is re-validated server-side on submit, and
 * pre-emptively disabling the only action on the screen because a read failed would strand the viewer.
 */
export const EMPTY_ROSTER: Readonly<Omit<WorkspaceRoster, "kind">> = Object.freeze({
	items: [],
	invitations: [],
	actingId: null,
	canCreate: true,
	createBlockedReason: null,
});

/** The safe empty roster for a kind. */
export function emptyRoster(kind: WorkspaceKind): WorkspaceRoster {
	return { kind, ...EMPTY_ROSTER };
}
// #endregion

// #region Roster
/**
 * Resolve the roster index for a kind and viewer.
 *
 * Total by construction: a failed or empty read degrades to {@link emptyRoster} rather than throwing, so
 * the index always renders.
 */
export function resolveRoster(
	kind: WorkspaceKind,
	context: UserContext,
	sim?: WorkspaceSim,
): WorkspaceRoster {
	const res = WorkspaceBackendService.roster(kind, context, sim);
	return res.ok && res.data ? res.data : emptyRoster(kind);
}
// #endregion

// #region Console detail
/**
 * Resolve one entity's console projection, or `null` when it does not exist or the viewer is not a member.
 *
 * **`null` deliberately does NOT degrade to an empty detail.** A fabricated console would show a real
 * name, an empty roster and a zeroed wallet to somebody who has no relationship with the entity — which
 * reads as "your team lost its members and its money", the single worst lie this surface could tell. A
 * missing entity is a not-found, and the route must render it as one. The degrade-to-empty pattern is
 * correct for a LIST (nothing to show yet) and wrong for an IDENTITY (this thing is not yours to see).
 */
export function resolveWorkspaceDetail(
	kind: WorkspaceKind,
	id: string,
	context: UserContext,
	sim?: WorkspaceSim,
): WorkspaceDetail | null {
	if (!id) return null;
	const res = WorkspaceBackendService.detail(kind, id, context, sim);
	return res.ok && res.data ? res.data.workspace : null;
}
// #endregion

// #region Console bootstrap (detail + the viewer's module set + a corrected active module)
/** Everything a console route and its bands need without a second read or a client round-trip. */
export interface WorkspaceConsoleBootstrap {
	workspace: WorkspaceDetail;
	/** The modules this viewer may open, in registry order — the lane, rail and header all read this. */
	modules: WorkspaceModule[];
	/** The module actually being rendered, after correction. */
	activeModule: ModuleKey;
	/**
	 * Set when {@link activeModule} is not the module the URL asked for, so the route can redirect to the
	 * canonical address instead of quietly rendering something else at the wrong URL.
	 */
	redirectedFrom: string | null;
}

/**
 * Resolve a console route in one call: the detail, the viewer's visible modules, and the module to render.
 *
 * The correction step is where the **"never 404 a user out of their own workspace"** invariant is actually
 * enforced. Three outcomes, deliberately distinct:
 *
 *   - The requested key is not in the registry → the caller passed `null`/an unknown segment, and the
 *     route should 404: a bad link is a bad link, and silently redirecting it hides a broken URL.
 *   - The key is a real module the viewer may not open → correct to {@link firstModuleFor} and report
 *     `redirectedFrom`, so a member who follows a colleague's link to Roles lands on their own Overview
 *     rather than being told they do not belong here.
 *   - Otherwise → render exactly what was asked for.
 *
 * Returns `null` only when the entity itself did not resolve (see {@link resolveWorkspaceDetail}).
 */
export function resolveWorkspaceConsole(
	kind: WorkspaceKind,
	id: string,
	requested: ModuleKey,
	context: UserContext,
	sim?: WorkspaceSim,
): WorkspaceConsoleBootstrap | null {
	const workspace = resolveWorkspaceDetail(kind, id, context, sim);
	if (!workspace) return null;

	const capabilities = workspace.viewerCapabilities;
	const modules = modulesForViewer(kind, capabilities);
	const permitted = mayViewModule(requested, kind, capabilities);
	const activeModule = permitted ? requested : firstModuleFor(kind, capabilities);

	return {
		workspace,
		modules,
		activeModule,
		redirectedFrom: permitted ? null : requested,
	};
}
// #endregion
