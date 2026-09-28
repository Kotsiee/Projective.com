import type { JSX } from "preact";
import {
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceKind,
	type WorkspaceRoster as RosterPage,
} from "@projective/types/workspace";
import type { ReadActor } from "@server/services/read-actor.ts";
import { isModuleKey, type ModuleKey } from "./module-registry.tsx";
import { resolveRoster, resolveWorkspaceConsole } from "./workspace-ssr.ts";
import { toModuleTab, toRosterTab } from "./workspace-model.ts";
import WorkspaceRoster from "../islands/WorkspaceRoster.island.tsx";

/**
 * workspace-route — what every `/teams*` and `/businesses*` route resolves before rendering.
 *
 * The routes stay thin (root CLAUDE.md §2) and the two kinds share ONE implementation:
 * `/teams/[teamHandle]/members` and `/businesses/[businessHandle]/members` differ by a single argument,
 * so there is no second copy to keep in step.
 *
 * **Console resolution returns DATA, not markup.** In Fresh a page component renders JSX, so a
 * `Response` returned from one is dead code — a redirect has to be issued from the route's `handler`.
 * Keeping this a data resolver means the handler can redirect and the component can render, each doing
 * the one thing it is able to do.
 *
 * Server-only — reaches `@server/services` through `workspace-ssr`; never imported by an island.
 */

/** Everything a console page needs, already corrected. Plain JSON, so it survives `page()`. */
export interface ConsoleData {
	workspace: WorkspaceDetail;
	module: ModuleKey;
	view: string | null;
}

/**
 * What a console route resolved to.
 *
 *   - `data` — render exactly what was asked for.
 *   - `redirect` — the canonical address differs from the one requested: a REAL module the viewer may
 *     not open (so they land on the one they can, instead of being told they do not belong in their own
 *     workspace), or an entity addressed by its row id or a differently-cased handle (so every console
 *     has exactly one address, its `@handle`).
 *   - `missing` — an unregistered segment, an unknown entity, or one the viewer is not a member of; a bad
 *     link should look broken rather than silently resolve somewhere plausible.
 */
export type ConsoleOutcome =
	| { kind: "data"; data: ConsoleData }
	| { kind: "redirect"; to: string }
	| { kind: "missing" };

/** The roster index body, for `/teams` and `/businesses` (and their `create` deep links). */
export async function rosterBody(
	kind: WorkspaceKind,
	url: URL,
	actor: ReadActor,
): Promise<JSX.Element> {
	const read = await resolveRoster(kind, actor, url);
	const initial: RosterPage = read.ok ? read.roster : {
		kind,
		items: [],
		invitations: [],
		actingId: null,
		canCreate: true,
		createBlockedReason: null,
	};
	// `/teams/create` and `/businesses/create` land here with the modal open, so the sitemap's deep link
	// and a shared URL both work without a second page to keep in step with the modal.
	const autoCreate = url.pathname.endsWith("/create");
	return (
		<WorkspaceRoster
			kind={kind}
			initial={initial}
			initialError={read.ok ? null : read.message}
			initialTab={toRosterTab(url.searchParams.get("tab"))}
			initialSearch={url.searchParams.get("q") ?? ""}
			autoCreate={autoCreate}
		/>
	);
}

/** Resolve a console route to data, a redirect, or a miss. Called from a route `handler`. */
export async function consoleOutcome(
	kind: WorkspaceKind,
	ref: string,
	rawModule: string,
	url: URL,
	actor: ReadActor,
): Promise<ConsoleOutcome> {
	if (!isModuleKey(rawModule)) return { kind: "missing" };

	const bootstrap = await resolveWorkspaceConsole(kind, ref, rawModule as ModuleKey, actor, url);
	if (!bootstrap) return { kind: "missing" };

	const { workspace } = bootstrap;
	if (bootstrap.redirectedFrom || ref !== workspace.handle) {
		const to = workspaceHref(kind, workspace.handle, bootstrap.activeModule);
		// A module redirect drops `?view=` (it belonged to the module the viewer cannot open); a pure
		// canonicalisation keeps the query, so a shared link to a sub-view survives the move to the handle.
		return { kind: "redirect", to: bootstrap.redirectedFrom ? to : `${to}${url.search}` };
	}

	return {
		kind: "data",
		data: {
			workspace,
			module: bootstrap.activeModule,
			view: toModuleTab(bootstrap.activeModule, kind, url.searchParams.get("view")),
		},
	};
}
