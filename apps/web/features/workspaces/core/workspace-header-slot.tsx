import type { ComponentChildren } from "preact";
import type { ReadActor } from "@server/services/read-actor.ts";
import { workspaceHref } from "@projective/types/workspace";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import WorkspaceHeaderBand from "../islands/WorkspaceHeaderBand.island.tsx";
import WorkspaceChannelHeader from "../islands/WorkspaceChannelHeader.island.tsx";
import FilesHeaderBand from "@features/files/islands/FilesHeaderBand.island.tsx";
import { folderSegmentsOfQuery } from "@projective/types/files";
import { entityDriveView } from "./files-module-model.ts";
import { channelDetailsInfo } from "../components/ChannelDetails.tsx";
import { channelHref, channelTabOfPath } from "./channel-model.ts";
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

	// On a channel the band is the room's own header — identity, Chat · Files, and its actions — the
	// twin of a project channel's and a conversation's (Decision #308).
	const slug = bootstrap.activeModule === "channels" ? channelSlugOfPath(url.pathname) : null;
	const channel = slug ? bootstrap.workspace.channels.find((c) => c.slug === slug) ?? null : null;
	if (channel) {
		const thread = await WorkspaceBackendService.channelThread(
			kind,
			bootstrap.workspace.handle,
			channel.slug,
			actor,
		);
		if (thread.ok && thread.data) {
			const channelsBase = workspaceHref(kind, bootstrap.workspace.handle, "channels");
			return (
				<WorkspaceChannelHeader
					kind={kind}
					entityId={bootstrap.workspace.id}
					channel={thread.data.channel}
					conversationId={thread.data.conversationId}
					channelsBase={channelsBase}
					channelBase={channelHref(channelsBase, channel.slug)}
					activeTab={channelTabOfPath(url.pathname)}
					details={channelDetailsInfo(bootstrap.workspace, thread.data.channel)}
				/>
			);
		}
	}

	// On Files the band is the `/files` hub's own — the trail, search, filter and sort (Decision #315).
	if (bootstrap.activeModule === "files") {
		const ws = bootstrap.workspace;
		return (
			<FilesHeaderBand
				base={entityDriveView(ws).base}
				routing="query"
				scope="workspace"
				subjectId={ws.id}
				segments={folderSegmentsOfQuery(url.search)}
				ownerLabel={ws.name}
			/>
		);
	}

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
