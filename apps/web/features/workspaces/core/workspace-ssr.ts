import type {
	BusinessBench,
	WorkspaceDetail,
	WorkspaceKind,
	WorkspaceRoster,
} from "@projective/types/workspace";
import type { CalendarPage } from "@projective/types/scheduling";
import {
	type AssetListPage,
	type AssetTreeNode,
	folderSegmentsOfQuery,
} from "@projective/types/files";
import type { ReadActor } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import {
	firstModuleFor,
	mayViewModule,
	type ModuleKey,
	modulesForViewer,
	type WorkspaceModule,
} from "./module-registry.tsx";
import type { UserContext } from "@projective/types/auth";
import { catalogueBase } from "@projective/types/catalogue";
import { teamSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { consoleParamsOf, resolveCataloguePage } from "@features/catalogue/core/catalogue-ssr.ts";
import { entityCalendarProjectIds } from "./calendar-module-model.ts";
import { laneListingsOf, type LaneListingsRead } from "./lane-model.ts";
import { once, resolveWorkspaceDetail } from "./workspace-memo.ts";

/**
 * workspace-ssr — the **server-only** bootstraps for the `/teams` and `/businesses` first paint.
 *
 * These call the fat {@link WorkspaceBackendService} **directly, with no HTTP hop**, as the signed-in
 * viewer, so the roster, the console, the lane's nav and the header band all ship in the initial byte;
 * the islands then refine through the thin `WorkspaceService`. Mirrors `wallet/core/wallet-ssr.ts`.
 *
 * **Never import this from an island.** It reaches `@server/services`, which would drag the backend
 * package into a client bundle and break the islands-are-dumb boundary (root CLAUDE.md §2). The `*-slot`
 * resolvers and route handlers are its only legitimate callers. Every read shares one request memo
 * (`workspace-memo.ts`), which also holds the console detail read.
 */

export { resolveWorkspaceDetail };

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

// #region The Talent module's bench
/**
 * The Talent module's first paint: the bench, or why it could not be read. A failed read is never
 * drawn as an empty bench — "nobody hired yet" said to a business with providers at work is false.
 */
export interface BenchRead {
	bench: BusinessBench | null;
	error: string | null;
}

/** Read a business's bench as the viewer — only the Talent module asks. Memoized per request. */
export function resolveBench(handle: string, actor: ReadActor, url: URL): Promise<BenchRead> {
	return once(url, actor, `bench:${handle.toLowerCase()}`, async (): Promise<BenchRead> => {
		const res = await WorkspaceBackendService.bench(handle, actor);
		if (res.ok && res.data) return { bench: res.data, error: null };
		return {
			bench: null,
			error: res.message ?? "The bench couldn't be read just now. Try again in a moment.",
		};
	});
}
// #endregion

// #region The Calendar module's union
/**
 * The Calendar module's first paint: the entity calendar, or why it could not be read. A failed read
 * is never drawn as an empty grid — "nothing scheduled" said of an entity with meetings this week is
 * false.
 */
export interface EntityCalendarRead {
	page: CalendarPage | null;
	error: string | null;
	/** How many projects the union was read across. */
	projectCount: number;
}

/**
 * Read an entity's calendar (Decision #308) — the union of its projects' calendars, as the viewer —
 * from the console's own detail, so the project list is the detail read's and never a request's. Only
 * the Calendar module asks. Memoized per request.
 */
export function resolveEntityCalendar(
	workspace: WorkspaceDetail,
	actor: ReadActor,
	url: URL,
): Promise<EntityCalendarRead> {
	const projectIds = entityCalendarProjectIds(workspace);
	return once(url, actor, `calendar:${workspace.kind}:${workspace.id}`, async () => {
		const res = await ScheduleBackendService.entityCalendar(
			{ projectIds, ref: workspace.handle, title: workspace.name },
			actor,
		);
		if (res.ok && res.data) {
			return { page: res.data.page, error: null, projectCount: projectIds.length };
		}
		return {
			page: null,
			error: res.message ?? "The calendar couldn't be read just now. Try again in a moment.",
			projectCount: projectIds.length,
		};
	});
}
// #endregion

// #region The Files module's drive
/**
 * The Files module's first paint: one location of the entity's drive, or why it could not be read,
 * the folder path `?path=` addressed, and the drive's folder tree (`[]` when it could not be read — the
 * folder panel then reads it again in the browser). A failed read is never drawn as an empty drive.
 */
export interface EntityDriveRead {
	page: AssetListPage | null;
	error: string | null;
	path: string[];
	tree: AssetTreeNode[];
}

/**
 * Read the entity's drive at the folder `?path=` names (Decision #306 (D)), as the viewer — the
 * server confirms the viewer's active seat before it reads a row. Only the Files module asks, and the
 * header band and footer rig read the same path from the same URL. Memoized per request.
 */
export function resolveEntityDrive(
	workspace: Pick<WorkspaceDetail, "kind" | "id" | "name">,
	actor: ReadActor,
	url: URL,
): Promise<EntityDriveRead> {
	const path = folderSegmentsOfQuery(url.search);
	return once(url, actor, `drive:${workspace.kind}:${workspace.id}`, async () => {
		const [res, folders] = await Promise.all([
			FilesBackendService.list({
				scope: "workspace",
				subjectId: workspace.id,
				path: path.length > 0 ? path : undefined,
				sort: "date",
				dir: "desc",
			}, actor),
			FilesBackendService.tree(actor, { scope: "workspace", subjectId: workspace.id }),
		]);
		const tree = folders.ok && folders.data ? folders.data : [];
		if (res.ok && res.data) return { page: res.data, error: null, path, tree };
		return {
			page: null,
			error: res.status === 404 && path.length > 0
				? "That folder doesn't exist — it may have been moved or deleted."
				: res.message ?? `${workspace.name}'s files couldn't be loaded just now.`,
			path,
			tree,
		};
	});
}
// #endregion

// #region The lane's Catalogue section
/**
 * The team lane's Catalogue listings (Decision #316), read as the team, or why they could not be read;
 * `null` when the viewer may not open the team's catalogue. Read with the console's resting params
 * through the catalogue's request memo, so the console on its resting view shares this one read.
 */
export async function resolveLaneListings(
	workspace: WorkspaceDetail,
	context: UserContext,
	actor: ReadActor,
	url: URL,
): Promise<LaneListingsRead | null> {
	const seller = teamSellerActor(workspace, actor);
	if (!seller) return null;
	const resting = consoleParamsOf(new URL(catalogueBase(workspace.handle), url));
	const { page, error } = await resolveCataloguePage(context, url, seller, resting);
	return error ? { ok: false, message: error } : { ok: true, listings: laneListingsOf(page) };
}
// #endregion
