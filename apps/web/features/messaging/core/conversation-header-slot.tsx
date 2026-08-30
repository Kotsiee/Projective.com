import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ConversationHeader from "../islands/ConversationHeader.island.tsx";
import { activeConversationTabOf, conversationHref } from "./conversation-model.ts";
import { resolveConversation } from "./conversations-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * conversation-header-slot — the SSR-idiomatic resolver for the middle-nav frame's header band on a
 * `/messages/[conversationId]` route (the messaging counterpart of `channelHeaderFor`). The
 * `(dashboard)` layout calls {@link conversationHeaderFor} with the request URL and threads the result
 * into `UserShell`'s `middleNavHeader`, so the conversation header paints in the first byte, flush
 * against the inbox lane as one connected strip (DESIGN_SYSTEM.md §D.4). Returns `null` off a specific
 * conversation (e.g. the `/messages` root), so the band collapses.
 *
 * Server-only (it reaches `@server/services` via {@link resolveConversation}); never imported by an
 * island.
 */
export async function conversationHeaderFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean); // ["messages", conversationId, ...tab]
	if (segs[0] !== "messages" || segs.length < 2) return null;

	const conversationId = segs[1];
	const detail = await resolveConversation(conversationId, actor);
	if (!detail) return null;

	const base = conversationHref(conversationId);
	return (
		<ConversationHeader
			detail={detail}
			base={base}
			activeTab={activeConversationTabOf(url.pathname, base)}
		/>
	);
}
