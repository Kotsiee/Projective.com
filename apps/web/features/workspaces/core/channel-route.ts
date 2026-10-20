import {
	DEFAULT_CHANNEL_SLUG,
	type EntityChannel,
	type WorkspaceDetail,
	workspaceHref,
	type WorkspaceKind,
} from "@projective/types/workspace";
import type { ReadActor } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import { resolveConversationMessages } from "@web/features/messaging/core/conversations-ssr.ts";
import type { MessagePage } from "@web/features/messaging/types/messaging-types.ts";
import type { ConsoleRedirect } from "./console-route.ts";
import { consoleOutcome } from "./workspace-route.tsx";

/**
 * channel-route — what `/teams/:h/channels[/:channel]` and the business twin resolve before rendering
 * (Decision #306). Thin routes, one implementation for both kinds.
 *
 * The console's own resolution runs first (`consoleOutcome` on the `channels` module), so a uuid or
 * non-canonical handle 308s and a non-member 303s exactly as on every other module. Then:
 *
 *   - `/channels` 303s to the entity's default channel (`general`), or renders an empty state when the
 *     entity has none.
 *   - `/channels/:channel` resolves the slug to its conversation (`WorkspaceBackendService
 *     .channelThread`) and reads its latest page for the `/messages` chat stack; an unknown or archived
 *     slug 303s back to `/channels`, which lands on the default — never a dead page.
 *
 * Server-only; never imported by an island.
 */

/** Everything a channel page needs. */
export interface ChannelPageData {
	workspace: WorkspaceDetail;
	/** `null` on `/channels` when the entity has no channel to land on. */
	channel: EntityChannel | null;
	conversationId: string | null;
	page: MessagePage | null;
}

/** What a channel route resolved to. */
export type ChannelOutcome = { kind: "data"; data: ChannelPageData } | ConsoleRedirect;

/** The channel a bare `/channels` lands on: the default, else the first listed, else none. */
export function landingChannel(channels: readonly EntityChannel[]): EntityChannel | null {
	return channels.find((c) => c.isDefault) ??
		channels.find((c) => c.slug === DEFAULT_CHANNEL_SLUG) ??
		channels[0] ?? null;
}

/** Re-point a console redirect at the channel being asked for, keeping its query. */
function withSlug(outcome: ConsoleRedirect, slug: string): ConsoleRedirect {
	if (outcome.kind !== "canonical") return outcome;
	const to = new URL(outcome.to, "http://x");
	if (!to.pathname.endsWith("/channels")) return outcome;
	to.pathname = `${to.pathname}/${encodeURIComponent(slug)}`;
	return { kind: "canonical", to: `${to.pathname}${to.search}` };
}

/** Resolve a channel route. `slug` is the `[channel]` segment, or `null` from `/channels` itself. */
export async function channelOutcome(
	kind: WorkspaceKind,
	ref: string,
	slug: string | null,
	url: URL,
	actor: ReadActor,
): Promise<ChannelOutcome> {
	const resolved = await consoleOutcome(kind, ref, "channels", url, actor);
	if (resolved.kind !== "data") return slug ? withSlug(resolved, slug) : resolved;
	const { workspace } = resolved.data;
	const base = workspaceHref(kind, workspace.handle, "channels");

	if (!slug) {
		const landing = landingChannel(workspace.channels);
		if (landing) {
			return { kind: "redirect", to: `${base}/${encodeURIComponent(landing.slug)}` };
		}
		return { kind: "data", data: { workspace, channel: null, conversationId: null, page: null } };
	}

	const thread = await WorkspaceBackendService.channelThread(kind, workspace.handle, slug, actor);
	if (!thread.ok || !thread.data) return { kind: "redirect", to: base };
	const page = await resolveConversationMessages(thread.data.conversationId, actor);
	return {
		kind: "data",
		data: {
			workspace,
			channel: thread.data.channel,
			conversationId: thread.data.conversationId,
			page,
		},
	};
}
