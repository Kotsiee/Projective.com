import type { ComponentChildren, JSX } from "preact";
import type { MessageDelta, MessageDeltaOp } from "@projective/types/projects";
import { MessageText } from "@web/features/links/components/MessageLinks.tsx";

/**
 * MessageRichText — a message body with its inline formatting.
 *
 * Renders the stored Delta run by run, each run's words passed through {@link MessageText} so a link
 * inside bold text is still an anchor routed through the same `/exit` safety rule as any other. No
 * markup is ever taken from the message: the four marks map to four fixed elements and the words are
 * text nodes, so a body that spells `<img onerror=…>` renders those characters and nothing else.
 *
 * Falls back to the plain body when there is no Delta — which is also what a read does when the
 * Delta no longer agrees with the body (`messageDeltaFor`), so the two paths cannot show different
 * words.
 */

export interface MessageRichTextProps {
	text: string;
	delta: MessageDelta | null;
}

/** Wrap one run's text in its marks — strike outermost, bold innermost, a fixed order so equal runs nest alike. */
function renderRun(op: MessageDeltaOp): ComponentChildren {
	let node: ComponentChildren = <MessageText text={op.insert} />;
	const marks = op.attributes;
	if (!marks) return node;
	if (marks.bold) node = <strong class="msg-rich__bold">{node}</strong>;
	if (marks.italic) node = <em class="msg-rich__italic">{node}</em>;
	if (marks.underline) node = <u class="msg-rich__underline">{node}</u>;
	if (marks.strike) node = <s class="msg-rich__strike">{node}</s>;
	return node;
}

export function MessageRichText({ text, delta }: MessageRichTextProps): JSX.Element {
	if (!delta) return <MessageText text={text} />;
	const runs = delta.ops.map((op, i) => <span key={i} class="msg-rich__run">{renderRun(op)}</span>);
	return <>{runs}</>;
}
