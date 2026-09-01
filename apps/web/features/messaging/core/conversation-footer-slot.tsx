import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ChatComposer from "@web/features/projects/islands/ChatComposer.island.tsx";
import ViewControlRig from "@web/features/projects/islands/ViewControlRig.island.tsx";
import { activeConversationTabOf, conversationHref } from "./conversation-model.ts";
import { resolveConversation } from "./conversations-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * conversation-footer-slot — the SSR-idiomatic resolver for the middle-nav frame's FOOTER band on a
 * `/messages/[conversationId]/{chat,files}` route (the messaging counterpart of `channelFooterFor` +
 * `filesFooterFor`). It mounts, per active tab, the SAME islands the project channels use — full parity:
 *
 *  - **Chat** → the {@link ChatComposer}, pinned to the viewport bottom (unified messaging — a
 *    conversation composes exactly like a channel; the send is stubbed until the backend lands).
 *  - **Files** → the File Explorer's {@link ViewControlRig} (the zoom slider), so the inbox Files tab
 *    gets the identical footer zoom control the projects Files tab has. The rig writes the shared
 *    `zoom` signal the (shared) File Explorer body reads, so dragging it scales the file thumbnails in
 *    real time.
 *
 * The Members tab has nothing in the footer. Returns `null` elsewhere so the band collapses.
 *
 * Server-only (it reaches `@server/services` via {@link resolveConversation}); never imported by an
 * island.
 */
export async function conversationFooterFor(
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
	const tab = activeConversationTabOf(url.pathname, base);
	if (tab === "files") return <ViewControlRig />;
	if (tab !== "chat") return null;

	// The scope is stated rather than left to the default: a conversation has no send endpoint of its
	// own yet, and a composer that assumed the projects one would post an inbox thread at a project
	// slug. Naming it here is what lets the messaging endpoint be wired without touching the composer.
	return (
		<ChatComposer
			scope="conversation"
			projectId={conversationId}
			channelId={conversationId}
		/>
	);
}
