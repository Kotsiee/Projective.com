import type { ComponentChildren } from "preact";
import type { ReadActor } from "@server/services/read-actor.ts";
import { channelDetailsInfo, ChannelDetailsPanel } from "../components/ChannelDetails.tsx";
import { channelTabOfPath } from "./channel-model.ts";
import { resolveWorkspaceConsole } from "./workspace-ssr.ts";
import {
	activeModuleOf,
	channelSlugOfPath,
	kindFromPath,
	workspaceHandleOf,
} from "./workspace-model.ts";

/**
 * workspace-panel-slot — the middle-nav frame's right PANEL inside a workspace console (Decision #308):
 * an entity channel's {@link ChannelDetailsPanel} on its Chat view, else `null` — the twin of the
 * project `channelPanelFor`. Only Chat docks it: Files needs the canvas's full width, so there the
 * header's Details control keeps its slide-over drawer. Docks from 1280px (`MiddleNavPanel`); below
 * that the header's drawer presents the same body.
 *
 * The detail comes from `workspace-ssr`'s request memo, so the panel, the lane and the header band are
 * one read. Server-only; never imported by an island.
 */
export async function workspaceChannelPanelFor(
	url: URL,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const kind = kindFromPath(url.pathname);
	const handle = kind ? workspaceHandleOf(url.pathname) : null;
	if (!kind || !handle || activeModuleOf(url.pathname) !== "channels") return null;
	const slug = channelSlugOfPath(url.pathname);
	if (!slug || channelTabOfPath(url.pathname) !== "chat") return null;

	const bootstrap = await resolveWorkspaceConsole(kind, handle, "channels", actor, url);
	if (!bootstrap || bootstrap.activeModule !== "channels") return null;
	const channel = bootstrap.workspace.channels.find((c) => c.slug === slug);
	if (!channel) return null;
	return <ChannelDetailsPanel info={channelDetailsInfo(bootstrap.workspace, channel)} />;
}
