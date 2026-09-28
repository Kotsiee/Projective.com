import type { ComponentChildren } from "preact";
import type { ReadActor } from "@server/services/read-actor.ts";
import WorkspaceLane from "../islands/WorkspaceLane.island.tsx";
import { resolveRoster, resolveWorkspaceConsole } from "./workspace-ssr.ts";
import { activeModuleOf, kindFromPath, toRosterTab, workspaceHandleOf } from "./workspace-model.ts";

/**
 * workspace-lane-slot — the SSR-idiomatic resolver for the middle-nav lane on any `/teams*` or
 * `/businesses*` route (mirrors `catalogueLaneFor` / `walletLaneFor`).
 *
 * The lane has two modes and the URL picks between them: on an index it is the entity ROSTER, and inside
 * an entity it is that entity's management rail. Resolving it server-side means the lane is painted in
 * the first byte — navigation chrome that arrives a frame late is the most noticeable kind of late.
 *
 * The entity mode resolves the console projection because the lane's nav is **capability-filtered**:
 * painting every module and hiding some on hydration would flash destinations the viewer may not open.
 * Both reads go through `workspace-ssr`'s request memo, so the lane shares them with the page handler
 * and the other two bands rather than reading the database again.
 *
 * Server-only — it reaches `@server/services` through `workspace-ssr`; never import it from an island.
 */
export async function workspaceLaneFor(url: URL, actor: ReadActor): Promise<ComponentChildren> {
	const kind = kindFromPath(url.pathname);
	if (!kind) return null;

	const handle = workspaceHandleOf(url.pathname);

	// Index mode — the roster, plus the partition the URL asked for so SSR and hydration agree.
	if (!handle) {
		const read = await resolveRoster(kind, actor, url);
		return (
			<WorkspaceLane
				kind={kind}
				path={url.pathname}
				roster={read.ok ? read.roster : undefined}
				tab={toRosterTab(url.searchParams.get("tab"))}
			/>
		);
	}

	// Entity mode — the management rail for one entity.
	const requested = activeModuleOf(url.pathname) ?? "overview";
	const bootstrap = await resolveWorkspaceConsole(kind, handle, requested, actor, url);
	// An entity that did not resolve falls back to the roster lane rather than an empty rail: the reader
	// still needs a way out, and a blank lane beside a miss is two dead ends instead of one.
	if (!bootstrap) {
		const read = await resolveRoster(kind, actor, url);
		return (
			<WorkspaceLane
				kind={kind}
				path={url.pathname}
				roster={read.ok ? read.roster : undefined}
				tab="all"
			/>
		);
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
