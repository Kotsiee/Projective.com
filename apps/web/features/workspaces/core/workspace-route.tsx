import type { JSX } from "preact";
import type { UserContext } from "@projective/types/auth";
import {
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import { isModuleKey, type ModuleKey } from "./module-registry.tsx";
import { resolveRoster, resolveWorkspaceConsole } from "./workspace-ssr.ts";
import { simFromParams } from "./workspace-seam.ts";
import { toModuleTab, toRosterTab } from "./workspace-model.ts";
import WorkspaceRoster from "../islands/WorkspaceRoster.island.tsx";

/**
 * workspace-route — what every `/teams*` and `/businesses*` route resolves before rendering.
 *
 * The routes stay thin (root CLAUDE.md §2) and, more importantly, the two kinds share ONE
 * implementation: `/teams/[id]/members` and `/businesses/[id]/members` differ by a single argument, so
 * there is no second copy to keep in step. That is the "the diff is a capability table, not a
 * duplicated folder" invariant, enforced at the route layer rather than merely intended.
 *
 * **Console resolution returns DATA, not markup.** In Fresh a page component renders JSX, so a
 * `Response` returned from one is dead code — a redirect has to be issued from the route's `handler`.
 * Keeping this a data resolver means the handler can redirect and the component can render, each doing
 * the one thing it is able to do. (An earlier shape returned JSX and silently rendered an empty body on
 * every gated module: the redirect never fired, which is precisely the dead end the invariant forbids.)
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
 * Three outcomes, deliberately distinct:
 *   - `data` — render exactly what was asked for.
 *   - `redirect` — a REAL module the viewer may not open; send them to the one they can, so a member
 *     following a colleague's link to Roles lands on their own Overview instead of being told they do
 *     not belong in their own workspace.
 *   - `missing` — an unregistered segment or an unknown entity; a bad link should look broken rather
 *     than silently resolve somewhere plausible.
 */
export type ConsoleOutcome =
	| { kind: "data"; data: ConsoleData }
	| { kind: "redirect"; to: string }
	| { kind: "missing" };

/** The roster index body, for `/teams` and `/businesses` (and their `create` deep links). */
export function rosterBody(
	kind: WorkspaceKind,
	url: URL,
	context: UserContext,
): JSX.Element {
	const roster = resolveRoster(kind, context, simFromParams(url.searchParams));
	// `/teams/create` and `/businesses/create` land here with the modal open, so the sitemap's deep link
	// and a shared URL both work without a second page to keep in step with the modal (brief §4).
	const autoCreate = url.pathname.endsWith("/create");
	return (
		<WorkspaceRoster
			kind={kind}
			initial={roster}
			initialTab={toRosterTab(url.searchParams.get("tab"))}
			initialSearch={url.searchParams.get("q") ?? ""}
			autoCreate={autoCreate}
		/>
	);
}

/** Resolve a console route to data, a redirect, or a miss. Called from a route `handler`. */
export function consoleOutcome(
	kind: WorkspaceKind,
	id: string,
	rawModule: string,
	url: URL,
	context: UserContext,
): ConsoleOutcome {
	if (!isModuleKey(rawModule)) return { kind: "missing" };

	const bootstrap = resolveWorkspaceConsole(
		kind,
		id,
		rawModule as ModuleKey,
		context,
		simFromParams(url.searchParams),
	);
	if (!bootstrap) return { kind: "missing" };

	if (bootstrap.redirectedFrom) {
		return { kind: "redirect", to: workspaceHref(kind, id, bootstrap.activeModule) };
	}

	return {
		kind: "data",
		data: {
			workspace: bootstrap.workspace,
			module: bootstrap.activeModule,
			view: toModuleTab(bootstrap.activeModule, kind, url.searchParams.get("view")),
		},
	};
}
