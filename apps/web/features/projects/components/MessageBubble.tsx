import type { JSX } from "preact";
import { cloneElement } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { MessageRow } from "../core/message-model.ts";
import type { RowBinding } from "../hooks/useMessageSelection.ts";
import { profileHref } from "../core/routing.ts";
import { MessageMedia } from "./MessageMedia.tsx";
import { MessageAudioPlayer } from "./MessageAudioPlayer.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { MessageContextMenu } from "./MessageContextMenu.tsx";
import { MessageReplyQuote } from "./MessageReplyQuote.tsx";
import { MessageBody } from "./MessageBody.tsx";
import { ReplyIcon, WonkyStarIcon } from "./chat-glyphs.tsx";
import { PinIcon } from "./channel-glyphs.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { MessageLinkPreviews } from "@web/features/links/components/MessageLinks.tsx";

/**
 * MessageBubble — one authored message in the feed (task §2/§3). Composes:
 *
 *   - **Alignment** — own messages align right, others left (`data-own`).
 *   - **Sender metadata** — a small avatar + name on the FIRST message of a same-author group (avatar
 *     + name both link to the canonical `/@handle`, Decision #3). Hidden entirely for the viewer's own
 *     messages, and for grouped continuation messages (only the first of a run carries it).
 *   - **Grouping geometry** — `data-pos` (single/first/middle/last) drives reduced separation + the
 *     corner masking (§2): for others the LEFT corners toward the group sharpen; for own the RIGHT.
 *   - **The line** — the bubble and, literally beside it, a side rail holding the ghost
 *     {@link MessageActions} toolbar with the viewer's own sent time directly beneath it. Both are
 *     always in the DOM and only fade in on hover, so revealing them never shifts the feed.
 *   - **Content** — a reply's {@link MessageReplyQuote}, the body with its inline formatting
 *     ({@link MessageBody} — inline, collapsed to four lines with Show more, or a card that opens a
 *     dialog, by length) and a preview row per link, a {@link MessageMedia} attachment layout,
 *     a {@link MessageAudioPlayer} memo, an emoji reaction row, and — when favourited — the custom
 *     "wonky star" mark on the bubble border.
 *   - **Selection** — when its surface runs `useMessageSelection`, the row carries that binding's
 *     state (`data-selected` / `data-focused`, which the surface CSS turns into the highlight-mode
 *     glow and blur), its click / context-menu / touch-gesture handlers, and — while it holds the
 *     keyboard cursor in highlight mode — the {@link MessageContextMenu}. A swipe reveals the reply cue
 *     at the row's edge.
 */

export interface MessageBubbleProps {
	row: MessageRow;
	canPin: boolean;
	onReply: (id: string) => void;
	onReact: (id: string, emoji: string) => void;
	onCopy: (id: string) => void;
	onTogglePin: (id: string) => void;
	onToggleFavorite: (id: string) => void;
	onReport: (id: string) => void;
	/** Jump to a quoted original (a reply's quote was pressed). */
	onJump: (id: string) => void;
	/** The surface's selection binding for this row; absent where a surface has no highlight mode. */
	selection?: RowBinding;
	/** How many messages are selected — the context menu's multi-message form reads it. */
	selectionCount?: number;
}

export function MessageBubble(props: MessageBubbleProps): JSX.Element {
	const { row, canPin, selection } = props;
	const m = row.message;
	const own = m.isOwn;
	const showMeta = !own && row.firstOfGroup;
	const sender = m.sender;
	const href = sender?.handle ? profileHref(sender.handle) : null;
	// Keep the hover toolbar visible while one of its popovers is open (the row lost :hover to the panel).
	const menuActive = useSignal(false);
	const rowRef = useRef<HTMLDivElement>(null);
	const bubbleRef = useRef<HTMLDivElement>(null);

	const hasText = m.text.trim().length > 0;
	const who = own ? "You" : sender?.name ?? "Unknown";

	return (
		<div
			ref={rowRef}
			class="msg-row"
			role="article"
			aria-label={`${who}, ${m.timeLabel}`}
			data-own={own ? "true" : undefined}
			data-pos={row.groupPos}
			data-active={menuActive.value ? "true" : undefined}
			{...selection?.attrs}
			{...selection?.handlers}
		>
			{/* Left gutter (others only) — the avatar on the first of a group, else the hover time. */}
			{!own && (
				<div class="msg-row__gutter">
					{row.firstOfGroup
						? (href
							? (
								<a class="msg-row__avatar-link" href={href} aria-label={sender?.name}>
									<UserAvatar image={sender?.avatar} label={sender?.name ?? "Unknown"} size={30} />
								</a>
							)
							: <UserAvatar image={sender?.avatar} label={sender?.name ?? "Unknown"} size={30} />)
						: <span class="msg-row__gutter-time" aria-hidden="true">{m.timeLabel}</span>}
				</div>
			)}

			<div class="msg-row__main">
				{/* Sender line — name + hover time (others, first of group only). */}
				{showMeta && (
					<div class="msg-meta">
						{href
							? <a class="msg-meta__name" href={href}>{sender?.name}</a>
							: <span class="msg-meta__name">{sender?.name}</span>}
						{m.pinned && (
							<span class="msg-meta__pin" aria-hidden="true">{cloneElement(PinIcon)}</span>
						)}
						<span class="msg-meta__time">{m.timeLabel}</span>
					</div>
				)}

				<div class="msg-row__line">
					<div
						ref={bubbleRef}
						class="msg-bubble"
						data-own={own ? "true" : undefined}
						data-pos={row.groupPos}
					>
						{m.replyTo && <MessageReplyQuote reply={m.replyTo} onJump={props.onJump} />}
						{hasText && (
							<MessageBody text={m.text} delta={m.delta} author={who} own={own} timeLabel={m.timeLabel} />
						)}
						{hasText && <MessageLinkPreviews text={m.text} />}
						{m.attachments.length > 0 && <MessageMedia attachments={m.attachments} />}
						{m.audio && <MessageAudioPlayer audio={m.audio} />}
						{m.favorited && (
							<span class="msg-bubble__fav" aria-label="Favourited" title="Favourited">
								{cloneElement(WonkyStarIcon)}
							</span>
						)}
					</div>

					{/* The side rail — ghost actions beside the bubble, the own sent time beneath them. */}
					<div class="msg-row__side">
						<MessageActions
							message={m}
							canPin={canPin}
							own={own}
							onReply={() => props.onReply(m.id)}
							onReact={(e) => props.onReact(m.id, e)}
							onCopy={() => props.onCopy(m.id)}
							onTogglePin={() => props.onTogglePin(m.id)}
							onToggleFavorite={() => props.onToggleFavorite(m.id)}
							onReport={() => props.onReport(m.id)}
							onOpenChange={(open) => (menuActive.value = open)}
						/>
						{own && <span class="msg-row__own-time" aria-hidden="true">{m.timeLabel}</span>}
					</div>
				</div>

				{m.reactions.length > 0 && (
					<div class="msg-reactions" role="group" aria-label="Reactions">
						{m.reactions.map((r) => (
							<button
								key={r.emoji}
								type="button"
								class="msg-reaction"
								data-mine={r.mine ? "true" : undefined}
								onClick={() => props.onReact(m.id, r.emoji)}
							>
								<span class="msg-reaction__emoji">{r.emoji}</span>
								<span class="msg-reaction__count">{r.count}</span>
							</button>
						))}
					</div>
				)}
			</div>

			{/* The swipe-to-reply cue, revealed at the edge the row is dragged away from. */}
			<span class="msg-row__swipe-cue" aria-hidden="true">{cloneElement(ReplyIcon)}</span>

			{selection?.menu && (
				<MessageContextMenu
					message={m}
					count={props.selectionCount ?? 1}
					canPin={canPin}
					anchorRef={bubbleRef}
					rowRef={rowRef}
					onReply={() => props.onReply(m.id)}
					onReact={(e) => props.onReact(m.id, e)}
					onCopy={() => props.onCopy(m.id)}
					onTogglePin={() => props.onTogglePin(m.id)}
					onToggleFavorite={() => props.onToggleFavorite(m.id)}
					onReport={() => props.onReport(m.id)}
				/>
			)}
		</div>
	);
}
