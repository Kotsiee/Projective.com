import type { JSX } from "preact";
import ChatFeed from "@web/features/projects/islands/ChatFeed.island.tsx";
import { MessagingService } from "../core/MessagingService.ts";
import type { MessagePage } from "../types/messaging-types.ts";

/**
 * ConversationChat — the `/messages/[conversationId]/chat` message stream. A thin wrapper that reuses the
 * project {@link ChatFeed} island verbatim (unified messaging — the same bottom-anchored, window-
 * virtualized feed), supplying a messaging-scoped older-page loader so scroll-up pagination hits
 * `/api/messaging/messages` instead of the project-channel endpoint. The composer is the middle-nav
 * frame's footer band (`conversationFooterFor`), not part of this body.
 */
export default function ConversationChat(
	{ conversationId, initial }: { conversationId: string; initial: MessagePage | null },
): JSX.Element {
	return (
		<ChatFeed
			projectId={conversationId}
			channelId={conversationId}
			initial={initial}
			loadOlder={(cursor) =>
				MessagingService.messages(conversationId, cursor).then((r) =>
					r.ok && r.data ? r.data.page : null
				)}
		/>
	);
}
