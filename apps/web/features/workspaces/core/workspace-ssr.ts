import type { WorkspaceDetail, WorkspaceKind, WorkspaceRoster } from "@projective/types/workspace";
import type { ReadActor } from "@server/services/read-actor.ts";
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
 * These call the fat {@link WorkspaceBackendService} **directly, with no HTTP hop**, as the signed-in
 * viewer, so the roster, the console, the lane's nav and the header band all ship in the initial byte;
 * the islands then refine through the thin `WorkspaceService`. Mirrors `wallet/core/wallet-ssr.ts`.
 *
 * **Never import this from an island.** It reaches `@server/services`, which would drag the backend
 * package into a client bundle and break the islands-are-dumb boundary (root CLAUDE.md §2). The `*-slot`
 * resolvers and route handlers are its only legitimate callers.
 */

// #region Request-scoped memo
/**
 * One read per question per request, however many regions ask.
 *
 * A console page is resolved by its route handler AND by the lane, header and footer slots; without this
 * the detail would be read from Postgres four times for one page (the roster three times on the index).
 * Keyed on the `URL` OBJECT, the wallet precedent: Fresh hands the handler and every slot resolver of one
 * request the same instance and the next request a new one, so an entry can never outlive the request
 * that made it — which matters, because the read after a mutation must see the mutation. The stored
 * value is the PROMISE, so the three bands, resolved concurrently, share one read in flight.
 */
const READS = new WeakMap<URL, Map<string, Promise<unknown>>>();

function once<T>(url: URL, actor: ReadActor, key: string, run: () => Promise<T>): Promise<T> {
	let reads = READS.get(url);
	if (!reads) {
		reads = new Map();
		READS.set(url, reads);
	}
	const slot = `${key}|${actor.userId}|${actor.contextId}`;
	const hit = reads.get(slot) as Promise<T> | undefined;
	if (hit) return hit;
	const promise = run();
	reads.set(slot, promise);
	return promise;
}
// #endregion

// #region Roster
/**
 * The outcome of a roster read: the roster, or why it could not be produced.
 *
 * A failed read is NOT folded into an empty roster. "You have no teams yet — create one" drawn for a
 * member of three teams because the database was unreachable is a false statement about their account;
 * the page renders the failure instead, and the empty state stays reserved for a roster that is empty.
 */
export type RosterRead = { ok: true; roster: WorkspaceRoster } | { ok: false; message: string };

/** Resolve the roster index for a kind, as the viewer. Memoized per request. */
export function resolveRoster(
	kind: WorkspaceKind,
	actor: ReadActor,
	url: URL,
): Promise<RosterRead> {
	return once(url, actor, `roster:${kind}`, async (): Promise<RosterRead> => {
		const res = await WorkspaceBackendService.roster(kind, actor);
		if (res.ok && res.data) return { ok: true, roster: res.data };
		return {
			ok: false,
			message: res.message ?? "We couldn't load your workspaces just now. Try again in a moment.",
		};
	});
}
// #endregion

// #region Console detail
/**
 * Resolve one entity's console projection by its handle (or row id), or `null` when it does not exist,
 * the viewer is not a member, or it could not be read.
 *
 * **`null` deliberately does NOT degrade to an empty detail.** A fabricated console would show a real
 * name, an empty roster and a zeroed wallet — which reads as "your team lost its members and its money",
 * the single worst lie this surface could tell. Memoized per request.
 */
export function resolveWorkspaceDetail(
	kind: WorkspaceKind,
	ref: string,
	actor: ReadActor,
	url: URL,
): Promise<WorkspaceDetail | null> {
	if (!ref) return Promise.resolve(null);
	return once(url, actor, `detail:${kind}:${ref.toLowerCase()}`, async () => {
		const res = await WorkspaceBackendService.detail(kind, ref, actor);
		return res.ok && res.data ? res.data : null;
	});
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
 * The correction step is where the **"never 404 a user out of their own workspace"** invariant is
 * enforced: a real module the viewer may not open corrects to {@link firstModuleFor} and reports
 * `redirectedFrom`, so a member following a colleague's link to Roles lands on their own Overview.
 * Returns `null` only when the entity itself did not resolve (see {@link resolveWorkspaceDetail}).
 */
export async function resolveWorkspaceConsole(
	kind: WorkspaceKind,
	ref: string,
	requested: ModuleKey,
	actor: ReadActor,
	url: URL,
): Promise<WorkspaceConsoleBootstrap | null> {
	const workspace = await resolveWorkspaceDetail(kind, ref, actor, url);
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
