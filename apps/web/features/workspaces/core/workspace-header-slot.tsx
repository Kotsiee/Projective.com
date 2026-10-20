import type { ComponentChildren } from "preact";
import type { ReadActor } from "@server/services/read-actor.ts";
import WorkspaceHeaderBand from "../islands/WorkspaceHeaderBand.island.tsx";
import { resolveWorkspaceConsole } from "./workspace-ssr.ts";
import {
	activeModuleOf,
	channelSlugOfPath,
	kindFromPath,
	workspaceHandleOf,
} from "./workspace-model.ts";
import { resolveSubView } from "./sub-views.ts";

/**
 * workspace-header-slot — the SSR-idiomatic resolver for the middle-nav HEADER band inside a workspace
 * console (mirrors `walletHeaderFor` / `channelHeaderFor`).
 *
 * It returns `null` on the roster index and everywhere off the surface, so the band **is not rendered
 * at all** rather than rendered empty — a slot that always mounts leaves a 3rem bar of nothing above
 * every page that has no header to put in it. The detail comes from `workspace-ssr`'s request memo.
 *
 * Server-only (reaches `@server/services` via `workspace-ssr`); never imported by an island.
 */
export async function workspaceHeaderFor(url: URL, actor: ReadActor): Promise<ComponentChildren> {
	const kind = kindFromPath(url.pathname);
	if (!kind) return null;

	const handle = workspaceHandleOf(url.pathname);
	// The index has its own in-body heading; a header band there would title the page twice.
	if (!handle) return null;

	const requested = activeModuleOf(url.pathname) ?? "overview";
	const bootstrap = await resolveWorkspaceConsole(kind, handle, requested, actor, url);
	if (!bootstrap) return null;

	// On a channel the band titles the room (`# delivery-sync`) over its topic (Decision #306).
	const slug = bootstrap.activeModule === "channels" ? channelSlugOfPath(url.pathname) : null;
	const channel = slug ? bootstrap.workspace.channels.find((c) => c.slug === slug) ?? null : null;

	return (
		<WorkspaceHeaderBand
			kind={kind}
			workspace={bootstrap.workspace}
			module={bootstrap.activeModule}
			channel={channel ? { slug: channel.slug, topic: channel.topic } : null}
			view={resolveSubView(
				bootstrap.activeModule,
				kind,
				bootstrap.workspace.viewerCapabilities,
				url.searchParams.get("view"),
			)}
			path={url.pathname}
		/>
	);
}
