import type { JSX } from "preact";
import { MessagingIcon } from "./messaging-glyphs.tsx";

/**
 * MessagesEmptyState — the `/messages` root body prompt shown before a conversation is opened (the lane
 * hosts the conversation list; the canvas invites the viewer to pick or start one). Server-rendered
 * (zero JS): the "New message" affordance lives in the sidebar.
 */
export function MessagesEmptyState(): JSX.Element {
	return (
		<div class="msg-empty">
			<span class="msg-empty__glyph" aria-hidden="true">
				<MessagingIcon name="inbox" />
			</span>
			<h1 class="msg-empty__title">Your messages</h1>
			<p class="msg-empty__note">
				Select a conversation from the list, or start a new message to reach a client, freelancer,
				team, or business.
			</p>
		</div>
	);
}
