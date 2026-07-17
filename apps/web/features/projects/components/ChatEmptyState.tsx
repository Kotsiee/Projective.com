import type { JSX } from "preact";
import { EmptyChatIcon } from "./chat-glyphs.tsx";

/**
 * ChatEmptyState — the empty channel placeholder (task §2): a large centred icon with descriptive text
 * beneath it, shown when a channel has no messages. Non-interactive content, so it leans on spacing +
 * type weight, not a box (§B.4).
 */
export function ChatEmptyState(): JSX.Element {
	return (
		<div class="chat-empty" role="status">
			<span class="chat-empty__icon" aria-hidden="true">{EmptyChatIcon}</span>
			<p class="chat-empty__title">No messages yet</p>
			<p class="chat-empty__note">
				This channel is quiet for now. Send the first message and it will appear right here.
			</p>
		</div>
	);
}
