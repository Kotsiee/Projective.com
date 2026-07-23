import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ChatComposer from "@web/features/projects/islands/ChatComposer.island.tsx";
import { activeConversationTabOf, conversationHref } from "./conversation-model.ts";
import { resolveConversation } from "./conversations-ssr.ts";

/**
 * conversation-footer-slot — the SSR-idiomatic resolver for the middle-nav frame's FOOTER band on a
 * `/messages/[conversationId]/chat` route (the messaging counterpart of `channelFooterFor`). It mounts
 * the SAME {@link ChatComposer} the project channels use (unified messaging — a conversation composes
 * exactly like a channel; the composer's send is stubbed until the backend lands), pinned to the
 * viewport bottom. Chat-tab only — the Files/Members tabs have nothing to compose. Returns `null`
 * elsewhere so the band collapses.
 *
 * Server-only (it reaches `@server/services` via {@link resolveConversation}); never imported by an
 * island.
 */
export function conversationFooterFor(url: URL, _context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["messages", conversationId, ...tab]
	if (segs[0] !== "messages" || segs.length < 2) return null;

	const conversationId = segs[1];
	const detail = resolveConversation(conversationId);
	if (!detail) return null;

	const base = conversationHref(conversationId);
	if (activeConversationTabOf(url.pathname, base) !== "chat") return null;

	return <ChatComposer projectId={conversationId} channelId={conversationId} />;
}
