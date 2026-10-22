import type { ComponentChildren } from "preact";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { ContextPanelDockOptions } from "@web/features/shell/core/context-panel-state.ts";
import { channelDetailsInfo, ChannelDetailsPanel } from "../components/ChannelDetails.tsx";
import MemberInspector from "../islands/MemberInspector.island.tsx";
import { MEMBER_PARAM } from "./member-inspector-model.ts";
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

/** The Members module's people section — the only body the member inspector stands beside. */
function onMembersModule(url: URL): boolean {
	return kindFromPath(url.pathname) !== null && activeModuleOf(url.pathname) === "members";
}

/**
 * The middle-nav frame's right PANEL on a team's or business's Members module (Decision #322): the
 * {@link MemberInspector}, registered on every reading (table, cards, org chart) so a pick docks it
 * without a navigation. `?member=<handle>` names the member it opens on; the island resolves it
 * against the same request-memoised detail the body reads. Server-only; never imported by an island.
 */
export async function workspaceMembersPanelFor(
	url: URL,
	actor: ReadActor,
): Promise<ComponentChildren> {
	if (!onMembersModule(url)) return null;
	const kind = kindFromPath(url.pathname);
	const handle = workspaceHandleOf(url.pathname);
	if (!kind || !handle) return null;
	const bootstrap = await resolveWorkspaceConsole(kind, handle, "members", actor, url);
	if (!bootstrap || bootstrap.activeModule !== "members") return null;
	return (
		<MemberInspector
			workspace={bootstrap.workspace}
			member={url.searchParams.get(MEMBER_PARAM)}
		/>
	);
}

/**
 * How the workspace's panel docks: the member inspector is a `selection` panel, painted open in the
 * first byte when the address names a member; every other workspace panel keeps the remembered
 * Details choice (`null`).
 */
export function workspacePanelDockFor(url: URL): ContextPanelDockOptions | null {
	if (!onMembersModule(url)) return null;
	return { dock: "selection", open: (url.searchParams.get(MEMBER_PARAM) ?? "") !== "" };
}
