import type { JSX } from "preact";
import { cloneElement } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import type { MessageRow } from "../core/message-model.ts";
import { profileHref } from "../core/routing.ts";
import { MessageMedia } from "./MessageMedia.tsx";
import { MessageAudioPlayer } from "./MessageAudioPlayer.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { WonkyStarIcon } from "./chat-glyphs.tsx";
import { PinIcon } from "./channel-glyphs.tsx";

/**
 * MessageBubble — one authored message in the feed (task §2/§3). Composes:
 *
 *   - **Alignment** — own messages align right, others left (`data-own`).
 *   - **Sender metadata** — a small avatar + name on the FIRST message of a same-author group (avatar
 *     + name both link to the canonical `/@handle`, Decision #3). Hidden entirely for the viewer's own
 *     messages, and for grouped continuation messages (only the first of a run carries it).
 *   - **Grouping geometry** — `data-pos` (single/first/middle/last) drives reduced separation + the
 *     corner masking (§2): for others the LEFT corners toward the group sharpen; for own the RIGHT.
 *   - **Hover** — reveals the sent time (no layout shift — it is always in the DOM, opacity-toggled) and
 *     the {@link MessageActions} toolbar (absolutely positioned, so it never reflows the feed).
 *   - **Content** — text, a {@link MessageMedia} attachment layout, a {@link MessageAudioPlayer} memo,
 *     an emoji reaction row, and — when favourited — the custom "wonky star" mark on the bubble border.
 */

export interface MessageBubbleProps {
	row: MessageRow;
	canPin: boolean;
	onReply: (id: string) => void;
	onReact: (id: string, emoji: string) => void;
	onTogglePin: (id: string) => void;
	onToggleFavorite: (id: string) => void;
	onReport: (id: string) => void;
}

export function MessageBubble(props: MessageBubbleProps): JSX.Element {
	const { row, canPin } = props;
	const m = row.message;
	const own = m.isOwn;
	const showMeta = !own && row.firstOfGroup;
	const sender = m.sender;
	const href = sender?.handle ? profileHref(sender.handle) : null;
	// Keep the hover toolbar visible while one of its popovers is open (the row lost :hover to the panel).
	const menuActive = useSignal(false);

	const hasText = m.text.trim().length > 0;

	return (
		<div
			class="msg-row"
			data-own={own ? "true" : undefined}
			data-pos={row.groupPos}
			data-active={menuActive.value ? "true" : undefined}
		>
			{/* Left gutter (others only) — the avatar on the first of a group, else the hover time. */}
			{!own && (
				<div class="msg-row__gutter">
					{row.firstOfGroup
						? (href
							? (
								<a class="msg-row__avatar-link" href={href} aria-label={sender?.name}>
									<Avatar image={sender?.avatar ?? undefined} label={sender?.name} size={30} />
								</a>
							)
							: <Avatar image={sender?.avatar ?? undefined} label={sender?.name} size={30} />)
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
						{m.pinned && <span class="msg-meta__pin" aria-hidden="true">{cloneElement(PinIcon)}</span>}
						<span class="msg-meta__time">{m.timeLabel}</span>
					</div>
				)}

				{/* Own messages reveal the time above the bubble on hover (absolute — no layout shift). */}
				{own && <span class="msg-row__own-time" aria-hidden="true">{m.timeLabel}</span>}

				<div class="msg-bubble" data-own={own ? "true" : undefined} data-pos={row.groupPos}>
					{hasText && <p class="msg-bubble__text">{m.text}</p>}
					{m.attachments.length > 0 && <MessageMedia attachments={m.attachments} />}
					{m.audio && <MessageAudioPlayer audio={m.audio} own={own} />}
					{m.favorited && (
						<span class="msg-bubble__fav" aria-label="Favourited" title="Favourited">
							{cloneElement(WonkyStarIcon)}
						</span>
					)}
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

			<MessageActions
				message={m}
				canPin={canPin}
				own={own}
				onReply={() => props.onReply(m.id)}
				onReact={(e) => props.onReact(m.id, e)}
				onTogglePin={() => props.onTogglePin(m.id)}
				onToggleFavorite={() => props.onToggleFavorite(m.id)}
				onReport={() => props.onReport(m.id)}
				onOpenChange={(open) => (menuActive.value = open)}
			/>
		</div>
	);
}
