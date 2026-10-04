import { cloneElement, type JSX } from "preact";
import type { MessageReply } from "@projective/types/projects";
import { ReplyIcon } from "./chat-glyphs.tsx";

/**
 * MessageReplyQuote — the quote at the top of a reply's bubble: who was answered and a one-line
 * excerpt of what they said. Pressing it jumps to the original (loading earlier history first when
 * the original is above the loaded window).
 *
 * A tonal inset rather than a bordered box or a coloured leading stripe: it is a control inside an
 * already-filled bubble, so a tint of the bubble's own ink separates it without a second container
 * colour (DESIGN_SYSTEM.md §B.4). An original that no longer resolves still renders, saying so, so
 * the reply never reads as a non-sequitur — and is then not a control, because there is nowhere to go.
 */

export interface MessageReplyQuoteProps {
	reply: MessageReply;
	onJump: (id: string) => void;
}

/** The quote's second line — the excerpt, or what the original was when it had no text. */
function quoteLine(reply: MessageReply): string {
	if (!reply.available) return "Original message unavailable";
	if (reply.excerpt) return reply.excerpt;
	if (reply.media === "audio") return "Voice message";
	if (reply.media === "attachment") return "Attachment";
	return "Message";
}

export function MessageReplyQuote({ reply, onJump }: MessageReplyQuoteProps): JSX.Element {
	const who = reply.isOwn ? "You" : reply.senderName ?? "Unknown";
	const line = quoteLine(reply);
	const body = (
		<>
			<span class="msg-quote__who">
				<span class="msg-quote__icon" aria-hidden="true">{cloneElement(ReplyIcon)}</span>
				{reply.available ? who : "Reply"}
			</span>
			<span class="msg-quote__text">{line}</span>
		</>
	);
	if (!reply.available) {
		return <span class="msg-quote" data-unavailable="true">{body}</span>;
	}
	return (
		<button
			type="button"
			class="msg-quote"
			aria-label={`Replying to ${who}: ${line}. Jump to the original message`}
			onClick={() => onJump(reply.id)}
		>
			{body}
		</button>
	);
}
