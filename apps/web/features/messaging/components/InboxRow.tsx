import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import { ConversationMenu } from "./ConversationMenu.tsx";
import { contextIsOffering, contextLabel, splitPreview } from "../core/inbox-model.ts";
import type { ConversationSummary, InboxFolder } from "../types/messaging-types.ts";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";

/**
 * InboxRow — one conversation in the `/messages` BODY list. The counterpart of {@link ConversationRow}
 * (which stays the lane's navigation row beside an open thread), sized for the content region rather
 * than a 280px column.
 *
 * The width buys three things the lane row could not afford: the preview runs at its natural measure
 * instead of clipping at 47%, the engagement context (`serviceName` / `productName` / `entityName`)
 * finally renders, and the state marks get their own trailing column instead of stealing from the text.
 *
 * The row is one anchor with a trailing action cluster as its SIBLING (never nested) — the `…` menu is
 * absolutely positioned over the metadata column so it costs the text nothing at rest, and swaps with
 * the timestamp on hover/focus rather than reserving width beside it. A coarse pointer cannot hover,
 * so there the menu takes its own trailing track and stays visible.
 */

// #region Props
export interface InboxRowProps {
	conversation: ConversationSummary;
	href: string;
	active: boolean;
	/** `compact` drops the context line and the second preview line. */
	compact: boolean;
	onToggleStar: (id: string) => void;
	onMove: (id: string, folder: InboxFolder) => void;
	onToggleMute: (id: string) => void;
	onDelete: (id: string) => void;
}
// #endregion

export function InboxRow(props: InboxRowProps): JSX.Element {
	const { conversation: c, href, active, compact } = props;
	const menuOpen = useSignal(false);
	const context = contextLabel(c);
	const { speaker, body } = splitPreview(c.preview);

	return (
		<div
			class="inbox-row"
			data-active={active ? "true" : undefined}
			data-unread={c.unread ? "true" : undefined}
			data-menu={menuOpen.value ? "true" : undefined}
		>
			{/* The unread mark lives in the gutter, so it costs the text column nothing. */}
			<span class="inbox-row__mark" aria-hidden="true" />

			<a class="inbox-row__link" href={href} aria-current={active ? "page" : undefined}>
				<span class="inbox-row__avatar">
					<Avatar
						image={c.avatar ?? undefined}
						fallbackImage={c.kind === "group" ? undefined : DEFAULT_AVATAR_URL}
						label={c.title}
						size={compact ? 32 : 40}
						shape={c.kind === "group" ? "square" : "circle"}
					/>
					{c.muted && (
						<span class="inbox-row__muted" aria-hidden="true">
							<MessagingIcon name="mute" />
						</span>
					)}
				</span>

				<span class="inbox-row__identity">
					<span class="inbox-row__name">{c.title}</span>
					{context && !compact && (
						<span
							class="inbox-row__context"
							data-offering={contextIsOffering(c) ? "true" : undefined}
						>
							{context}
						</span>
					)}
				</span>

				<span class="inbox-row__preview">
					{speaker && <span class="inbox-row__speaker">{speaker}:</span>}
					<span class="inbox-row__snippet">{body || "No messages yet"}</span>
				</span>

				<span class="inbox-row__meta">
					{c.starred && (
						<span class="inbox-row__starred" aria-label="Starred">
							<MessagingIcon name="star" />
						</span>
					)}
					<span class="inbox-row__time">{c.lastActivityLabel}</span>
				</span>
			</a>

			<ConversationMenu
				conversation={c}
				open={menuOpen}
				triggerClass="inbox-row__menu"
				onToggleStar={props.onToggleStar}
				onToggleMute={props.onToggleMute}
				onMove={props.onMove}
				onDelete={props.onDelete}
			/>
		</div>
	);
}
