import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WorkspaceHeaderBand from "../islands/WorkspaceHeaderBand.island.tsx";
import { resolveWorkspaceConsole } from "./workspace-ssr.ts";
import { simFromParams } from "./workspace-seam.ts";
import { activeModuleOf, kindFromPath, workspaceIdOf } from "./workspace-model.ts";

/**
 * workspace-header-slot — the SSR-idiomatic resolver for the middle-nav HEADER band inside a workspace
 * console (mirrors `walletHeaderFor` / `channelHeaderFor`).
 *
 * It returns `null` on the roster index and everywhere off the surface, so the band **is not rendered
 * at all** rather than rendered empty — a slot that always mounts leaves a 3rem bar of nothing above
 * every page that has no header to put in it.
 *
 * Server-only (reaches `@server/services` via `workspace-ssr`); never imported by an island.
 */
export function workspaceHeaderFor(url: URL, context: UserContext): ComponentChildren {
	const kind = kindFromPath(url.pathname);
	if (!kind) return null;

	const id = workspaceIdOf(url.pathname);
	// The index has its own in-body heading; a header band there would title the page twice.
	if (!id) return null;

	const requested = activeModuleOf(url.pathname) ?? "overview";
	const bootstrap = resolveWorkspaceConsole(
		kind,
		id,
		requested,
		context,
		simFromParams(url.searchParams),
	);
	if (!bootstrap) return null;

	return (
		<WorkspaceHeaderBand
			kind={kind}
			workspace={bootstrap.workspace}
			module={bootstrap.activeModule}
			view={url.searchParams.get("view")}
			path={url.pathname}
		/>
	);
}
