import type { JSX } from "preact";
import { MESSAGES_ROOT } from "../core/conversation-model.ts";
import { MessagingIcon } from "./messaging-glyphs.tsx";

/**
 * A calm not-found for a `/messages/[conversationId]` that resolves to nothing.
 *
 * It carries a real way out. The previous copy ended "Pick another from the list" — advice that is
 * unactionable below 767px, where the shell removes the lane the list lives in, and unhelpful above
 * it if the viewer arrived from a stale link. A link back to the inbox works at every width.
 */
export function ConversationNotFound(): JSX.Element {
	return (
		<div class="msg-empty">
			<span class="msg-empty__glyph" aria-hidden="true">
				<MessagingIcon name="inbox" />
			</span>
			<h1 class="msg-empty__title">Conversation not found</h1>
			<p class="msg-empty__note">
				This conversation doesn’t exist any more, or you no longer have access to it.
			</p>
			<a class="msg-empty__action" href={MESSAGES_ROOT}>
				<MessagingIcon name="back" />
				Back to your inbox
			</a>
		</div>
	);
}
