import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WorkspaceLane from "../islands/WorkspaceLane.island.tsx";
import { resolveRoster, resolveWorkspaceConsole } from "./workspace-ssr.ts";
import { simFromParams } from "./workspace-seam.ts";
import { activeModuleOf, kindFromPath, toRosterTab, workspaceIdOf } from "./workspace-model.ts";

/**
 * workspace-lane-slot — the SSR-idiomatic resolver for the middle-nav lane on any `/teams*` or
 * `/businesses*` route (mirrors `catalogueLaneFor` / `walletLaneFor`).
 *
 * The lane has two modes and the URL picks between them, which is why this is a pure function of the
 * URL rather than client state: on an index it is the entity ROSTER, and inside an entity it is that
 * entity's management rail. Resolving it server-side means the lane is painted in the first byte —
 * navigation chrome that arrives a frame late is the most noticeable kind of late.
 *
 * The entity mode resolves the full console projection because the lane's nav is
 * **capability-filtered**: the module list comes from `modulesForViewer`, so the lane cannot be drawn
 * without knowing the viewer's server-resolved effective capabilities. Painting every module and then
 * hiding some on hydration would flash destinations the viewer may not open.
 *
 * Server-only — it reaches `@server/services` through `workspace-ssr`; never import it from an island.
 */
export function workspaceLaneFor(url: URL, context: UserContext): ComponentChildren {
	const kind = kindFromPath(url.pathname);
	if (!kind) return null;

	const id = workspaceIdOf(url.pathname);
	// Parsed once: the lane paints the roster AND the capability-filtered rail, and both must agree with
	// whatever the developer is simulating or the nav would offer modules the body then refuses.
	const sim = simFromParams(url.searchParams);

	// Index mode — the roster, plus the partition the URL asked for so SSR and hydration agree.
	if (!id) {
		const roster = resolveRoster(kind, context, sim);
		return (
			<WorkspaceLane
				kind={kind}
				path={url.pathname}
				roster={roster}
				tab={toRosterTab(url.searchParams.get("tab"))}
			/>
		);
	}

	// Entity mode — the management rail for one entity.
	const requested = activeModuleOf(url.pathname) ?? "overview";
	const bootstrap = resolveWorkspaceConsole(kind, id, requested, context, sim);
	// An entity that did not resolve falls back to the roster lane rather than an empty rail: the reader
	// still needs a way out, and a blank lane beside a 404 body is two dead ends instead of one.
	if (!bootstrap) {
		const roster = resolveRoster(kind, context);
		return <WorkspaceLane kind={kind} path={url.pathname} roster={roster} tab="all" />;
	}

	return (
		<WorkspaceLane
			kind={kind}
			path={url.pathname}
			workspace={bootstrap.workspace}
			activeModule={bootstrap.activeModule}
		/>
	);
}
