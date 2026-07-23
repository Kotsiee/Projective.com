import type { JSX } from "preact";
import { MessagingIcon } from "./messaging-glyphs.tsx";

/** A calm not-found for a `/messages/[conversationId]` that resolves to nothing. */
export function ConversationNotFound(): JSX.Element {
	return (
		<div class="msg-empty">
			<span class="msg-empty__glyph" aria-hidden="true">
				<MessagingIcon name="inbox" />
			</span>
			<h1 class="msg-empty__title">Conversation not found</h1>
			<p class="msg-empty__note">
				This conversation doesn’t exist or you no longer have access. Pick another from the list.
			</p>
		</div>
	);
}
