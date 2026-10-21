import { workspaceBase, type WorkspaceDetail, workspaceHref } from "@projective/types/workspace";
import { catalogueBase, isTeamHandle, parseCataloguePath } from "@projective/types/catalogue";
import type { ReadActor } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import { once, resolveWorkspaceDetail } from "@features/workspaces/core/workspace-memo.ts";
import { mayManageTeamCatalogue } from "@features/workspaces/core/catalogue-gate.ts";

/**
 * seller-scope — whose catalogue a request is served as (Decision #312): the session's acting seller
 * on `/catalogue*`, or one team on `/teams/:handle/catalogue*` and on an `/api/catalogue/*` call that
 * carries `?team=`. A team answer is the team console's own: the database answers the detail for an
 * active member only, and the Catalogue's `publish_listings` gate (`catalogue-gate.ts`, which the
 * module registry reads) decides the rest — so the team catalogue is open to exactly the members its
 * console offers it to.
 *
 * It never loads the module registry (whose glyphs import CSS), so the catalogue's handlers and API
 * routes stay loadable under `deno test`; the redirects below are therefore the console's
 * (`console-route.ts` `routeConsole`) restated for this one module. Server-only.
 */

// #region Team seller
/** The seller a request reads and writes as, and the team when it is one. */
export interface SellerScope {
	actor: ReadActor;
	team: WorkspaceDetail | null;
}

/**
 * The actor a team's catalogue is read and written as: the viewer, acting AS that team, whatever
 * context the session is acting in. `null` unless the viewer may open the team's Catalogue.
 *
 * The catalogue scopes and checks ownership by the actor's context (`listing-scope.ts`
 * `actingTeam`, `ownership.ts`), so this is what lets a member manage the team's listings without
 * switching. The token is unchanged, so RLS stays the authority: nothing done as this actor reaches a
 * row the member's own JWT cannot.
 */
export function teamSellerActor(
	workspace: Pick<WorkspaceDetail, "id" | "kind" | "viewerCapabilities">,
	actor: ReadActor,
): ReadActor | null {
	if (!mayManageTeamCatalogue(workspace)) return null;
	return { ...actor, contextType: "team", contextId: workspace.id };
}
// #endregion

// #region Pages and bands
/** Where a team catalogue page request goes: rendered here, or redirected once. */
export type TeamCatalogueRoute =
	| { kind: "render" }
	| { kind: "redirect"; status: 303 | 308; location: string };

/**
 * The team console's answer for a catalogue page, given the detail the database returned for
 * `teamHandle` (`null`: no such team, or not a member). Each answer is ONE hop: no detail 303s to the
 * roster's notice; a viewer who may not open the Catalogue goes to the console root (Overview, which
 * every member may open) — a 303, or a 308 when the handle was also not canonical; a non-canonical
 * handle (a row id, another case) 308s to the canonical one, keeping the path below the catalogue
 * root and the query.
 */
export function teamCatalogueRoute(
	teamHandle: string,
	workspace: Pick<WorkspaceDetail, "kind" | "handle" | "viewerCapabilities"> | null,
	url: URL,
): TeamCatalogueRoute {
	if (!workspace) {
		return {
			kind: "redirect",
			status: 303,
			location: `${workspaceBase("team")}?notice=unavailable`,
		};
	}
	const canonical = teamHandle === workspace.handle;
	if (!mayManageTeamCatalogue(workspace)) {
		const location = workspaceHref("team", workspace.handle);
		return { kind: "redirect", status: canonical ? 303 : 308, location };
	}
	if (canonical) return { kind: "render" };
	const below = url.pathname.split("/").filter(Boolean).slice(3);
	const path = [catalogueBase(workspace.handle), ...below].join("/");
	return { kind: "redirect", status: 308, location: `${path}${url.search}` };
}

/**
 * A page handler's scope: off a team route the acting seller; on one the team, or the redirect
 * {@link teamCatalogueRoute} answers with.
 */
export async function routeSellerScope(
	teamHandle: string | undefined,
	url: URL,
	actor: ReadActor,
): Promise<SellerScope | Response> {
	if (teamHandle === undefined) return { actor, team: null };

	const workspace = await resolveWorkspaceDetail("team", teamHandle, actor, url);
	const route = teamCatalogueRoute(teamHandle, workspace, url);
	const seller = workspace && route.kind === "render" ? teamSellerActor(workspace, actor) : null;
	if (workspace && seller) return { actor: seller, team: workspace };
	const { status, location } = route.kind === "redirect"
		? route
		: { status: 303 as const, location: `${workspaceBase("team")}?notice=unavailable` };
	return new Response(null, { status, headers: { location } });
}

/**
 * A band resolver's scope for a catalogue path: the acting seller's, the team's, or `null` when the
 * path is not a catalogue path or the viewer may not open this team's (the route redirects then, so
 * the band never paints). Shares the console detail the route read, through the request memo.
 */
export async function pathSellerScope(
	url: URL,
	actor: ReadActor,
): Promise<(SellerScope & { rest: string[] }) | null> {
	const path = parseCataloguePath(url.pathname);
	if (!path) return null;
	if (!path.team) return { actor, team: null, rest: path.rest };
	const workspace = await resolveWorkspaceDetail("team", path.team, actor, url);
	const seller = workspace ? teamSellerActor(workspace, actor) : null;
	return workspace && seller ? { actor: seller, team: workspace, rest: path.rest } : null;
}
// #endregion

// #region API routes
/** A team catalogue's seller, or why the viewer may not act as it (an HTTP status and a sentence). */
export type TeamSellerRead =
	| { ok: true; workspace: WorkspaceDetail; actor: ReadActor }
	| { ok: false; status: number; message: string };

/**
 * Resolve the seller a `?team=` catalogue API call speaks for. The detail read's own status is kept,
 * so an expired session still answers 401 (which the client refreshes) and an outage 503; a missing
 * team and a non-member are one 404, so the answer never discloses that a team exists. Memoized.
 */
export function resolveTeamSeller(
	handle: string,
	actor: ReadActor,
	url: URL,
): Promise<TeamSellerRead> {
	return once(url, actor, `seller:${handle}`, async (): Promise<TeamSellerRead> => {
		const res = await WorkspaceBackendService.detail("team", handle, actor);
		if (!res.ok || !res.data) {
			if (res.status === 401) {
				return { ok: false, status: 401, message: "Sign in to manage your catalogue." };
			}
			if (res.status >= 500) {
				return { ok: false, status: 503, message: "We couldn't reach this team just now." };
			}
			return { ok: false, status: 404, message: "This team's catalogue isn't available to you." };
		}
		const seller = teamSellerActor(res.data, actor);
		if (!seller) {
			return {
				ok: false,
				status: 403,
				message: "Your role in this team can't manage its listings.",
			};
		}
		return { ok: true, workspace: res.data, actor: seller };
	});
}

function refusal(status: number, message: string): Response {
	return Response.json({ ok: false, message }, { status });
}

/**
 * An `/api/catalogue/*` route's actor: the session's, or — with `?team=<handle>` — the team's once
 * the viewer is verified as a member who may manage its listings. A refusal is the response to send.
 */
export async function apiSellerActor(url: URL, actor: ReadActor): Promise<ReadActor | Response> {
	const team = url.searchParams.get("team");
	if (team === null) return actor;
	if (!actor.userId) return refusal(401, "Sign in to manage your catalogue.");
	if (!isTeamHandle(team)) return refusal(404, "This team's catalogue isn't available to you.");
	const read = await resolveTeamSeller(team, actor, url);
	return read.ok ? read.actor : refusal(read.status, read.message);
}
// #endregion
