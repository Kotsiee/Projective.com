import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { BodyPortal } from "@projective/ui/overlay";
import { Dialog } from "@projective/ui/feedback";
import { useId } from "@projective/ui/hooks";
import type { MessageDelta } from "@projective/types/projects";
import { MessageRichText } from "./MessageRichText.tsx";
import { FileTypeGlyph } from "./composer-glyphs.tsx";
import { longMessageSummary, messageLengthOf } from "../core/message-length.ts";

/**
 * MessageBody — a message's text, presented by its length ({@link messageLengthOf}).
 *
 *  - **Inline** — the whole body, formatted.
 *  - **Collapsible** (over 750 characters or 10 lines) — clamped to four lines with a Show more /
 *    Show less toggle beneath it. The clamp is CSS (`line-clamp`), so the full text is in the DOM from
 *    the first byte — find-in-page, copy and assistive technology all reach it — and expanding is a
 *    style change, not a fetch. The toggle names what it controls (`aria-controls`, `aria-expanded`).
 *  - **Card** (over 4,000 characters) — the body becomes a card in the attachment idiom (type glyph,
 *    a title, middot meta, the opening line) that opens the full, formatted text in a dialog. Inline
 *    expansion at that length would push the rest of the conversation out of reach. The dialog is
 *    portalled to `document.body`: a message row carries a transform (the swipe) and, in highlight
 *    mode, a filter, either of which would trap a fixed-position overlay inside the row.
 *
 * The feed re-measures a row whose height changes (it observes its rows), so expanding a message in
 * the window-virtualized list does not overlap the one beneath it.
 */

export interface MessageBodyProps {
	text: string;
	delta: MessageDelta | null;
	/** Who wrote it — names the card and the dialog. */
	author: string;
	/** The viewer wrote it (the dialog is then "Your message"). */
	own: boolean;
	/** The sent time — the dialog's subtitle. */
	timeLabel: string;
}

/** Thousands-separated, identically on the server and in the browser (no locale drift). */
function count(n: number): string {
	return n.toLocaleString("en-US");
}

export function MessageBody({ text, delta, author, own, timeLabel }: MessageBodyProps): JSX.Element {
	const length = messageLengthOf(text);
	const expanded = useSignal(false);
	const open = useSignal(false);
	const bodyId = useId(undefined, "msg-body");

	if (length === "inline") {
		return (
			<p class="msg-bubble__text">
				<MessageRichText text={text} delta={delta} />
			</p>
		);
	}

	if (length === "collapsible") {
		return (
			<>
				<p
					id={bodyId}
					class="msg-bubble__text"
					data-collapsed={expanded.value ? undefined : "true"}
				>
					<MessageRichText text={text} delta={delta} />
				</p>
				<button
					type="button"
					class="msg-bubble__more"
					aria-expanded={expanded.value}
					aria-controls={bodyId}
					onClick={() => (expanded.value = !expanded.value)}
				>
					{expanded.value ? "Show less" : "Show more"}
				</button>
			</>
		);
	}

	const summary = longMessageSummary(text);
	return (
		<>
			<button
				type="button"
				class="msg-longcard"
				aria-haspopup="dialog"
				aria-label={`Long message from ${own ? "you" : author}, ${count(summary.words)} words. Open to read it.`}
				onClick={() => (open.value = true)}
			>
				<span class="msg-longcard__glyph" aria-hidden="true">
					<FileTypeGlyph ext="txt" />
				</span>
				<span class="msg-longcard__meta">
					<span class="msg-longcard__title">Long message</span>
					<span class="msg-longcard__sub">
						{count(summary.words)} words · {count(summary.chars)} characters
					</span>
					<span class="msg-longcard__preview">{summary.preview}</span>
				</span>
			</button>
			{open.value && (
				<BodyPortal>
					<Dialog
						visible={open}
						header={own ? "Your message" : `Message from ${author}`}
						width="min(44rem, calc(100vw - 2rem))"
						class="msg-longread-dialog"
						onVisibleChange={(v) => (open.value = v)}
					>
						<p class="msg-longread__when">{timeLabel}</p>
						<div class="msg-longread">
							<MessageRichText text={text} delta={delta} />
						</div>
					</Dialog>
				</BodyPortal>
			)}
		</>
	);
}
