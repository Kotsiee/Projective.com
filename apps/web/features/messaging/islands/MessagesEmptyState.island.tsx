import type { JSX } from "preact";
import "../styles/messages.css";
import "../styles/messages-root.css";
import { Button } from "@projective/ui/fields";
import { MessagingIcon } from "../components/messaging-glyphs.tsx";
import { openNewConversation } from "../core/messaging-state.ts";

/**
 * MessagesEmptyState — the `/messages` ROOT body on desktop, where no conversation is open: a
 * centred glyph, one sentence pointing at the conversation list in the lane, and the two ways to
 * start something new (a message, a group). Both open the ranked people picker the lane's
 * `MessagesSidebar` mounts, through the shared `messaging-state` bridge — this island owns no modal
 * of its own, so the root and an open conversation offer exactly one picker.
 *
 * Reuses the `.msg-empty` chrome the not-found body already draws, so an empty inbox root and a
 * missing conversation read as one vocabulary. Actions are the shared `Button`, not a local family.
 */
export default function MessagesEmptyState(): JSX.Element {
	return (
		<section class="msg-empty" aria-labelledby="msg-root-title">
			<span class="msg-empty__glyph" aria-hidden="true">
				<MessagingIcon name="chat" />
			</span>
			<h1 class="msg-empty__title" id="msg-root-title">Your messages</h1>
			<p class="msg-empty__note">
				Choose a conversation from the list to read it here, or start a new one.
			</p>
			<div class="msg-root__cta">
				<Button
					label="New message"
					icon={<MessagingIcon name="compose" />}
					onClick={() => openNewConversation()}
				/>
				<Button
					label="New group"
					variant="outlined"
					severity="secondary"
					icon={<MessagingIcon name="members" />}
					onClick={() => openNewConversation({ group: true })}
				/>
			</div>
		</section>
	);
}
