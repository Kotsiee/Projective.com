import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ConversationContextPanel from "../islands/ConversationContextPanel.island.tsx";
import { activeConversationTabOf, conversationHref } from "./conversation-model.ts";
import { resolveConversation, resolveConversationContext } from "./conversations-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * conversation-panel-slot — the SSR-idiomatic resolver for the middle-nav frame's right PANEL on a
 * `/messages/[conversationId]` route. A one-to-one conversation's Chat tab registers its
 * {@link ConversationContextPanel} (who the counterpart is, the request between the two, the rig); a
 * group, the Files and Members tabs, and the `/messages` root register nothing, so the frame has no
 * panel column and the canvas reaches the frame's inline-end edge. Mirrors the header's own gate
 * (`hasDetails` in `ConversationHeader`), so the Details toggle exists exactly where the panel does.
 *
 * Server-only (it reaches `@server/services`); never imported by an island.
 */
export async function conversationPanelFor(
	url: URL,
	_context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean); // ["messages", conversationId, ...tab]
	if (segs[0] !== "messages" || segs.length < 2) return null;

	const conversationId = segs[1];
	if (activeConversationTabOf(url.pathname, conversationHref(conversationId)) !== "chat") {
		return null;
	}

	const [detail, context] = await Promise.all([
		resolveConversation(conversationId, actor),
		resolveConversationContext(conversationId, actor),
	]);
	if (!detail || detail.kind === "group") return null;

	return (
		<ConversationContextPanel
			conversationId={conversationId}
			initial={context}
			folder={detail.folder}
		/>
	);
}
