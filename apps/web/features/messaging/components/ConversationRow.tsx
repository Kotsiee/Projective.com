import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import { ConversationMenu } from "./ConversationMenu.tsx";
import type { ConversationSummary, InboxFolder } from "../types/messaging-types.ts";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";

/**
 * ConversationRow — one conversation in the inbox lane (`/messages`). The row's anchor stretches over
 * the whole row; a fixed 48px action slot at its trailing edge holds the compact time and unread dot,
 * which hand over to the `…` menu on hover, focus or while the menu is open (opacity only, so the row
 * never shifts). A coarse pointer cannot hover, so there the menu stays visible beneath the time.
 * Icon-led + truncated per §B.6; unread is a dot, never a count.
 */

// #region Props
export interface ConversationRowProps {
	conversation: ConversationSummary;
	href: string;
	active: boolean;
	onToggleStar: (id: string) => void;
	onMove: (id: string, folder: InboxFolder) => void;
	onDelete: (id: string) => void;
}
// #endregion

export function ConversationRow(props: ConversationRowProps): JSX.Element {
	const { conversation: c, href, active } = props;
	const menuOpen = useSignal(false);

	return (
		<div
			class="msg-conv"
			data-active={active ? "true" : undefined}
			data-unread={c.unread ? "true" : undefined}
			data-menu={menuOpen.value ? "true" : undefined}
		>
			<a class="msg-conv__link" href={href} aria-current={active ? "page" : undefined}>
				<span class="msg-conv__avatar">
					<Avatar
						image={c.avatar ?? undefined}
						fallbackImage={c.kind === "group" ? undefined : DEFAULT_AVATAR_URL}
						label={c.title}
						size={40}
						shape={c.kind === "group" ? "square" : "circle"}
					/>
					{c.muted && (
						<span class="msg-conv__muted" aria-hidden="true">
							<MessagingIcon name="mute" />
						</span>
					)}
				</span>
				<span class="msg-conv__body">
					<span class="msg-conv__name">{c.title}</span>
					<span class="msg-conv__preview">{c.preview || "No messages yet"}</span>
				</span>
				<span class="ui-visually-hidden">
					{`, ${c.lastActivityLabel}${c.unread ? ", unread" : ""}`}
				</span>
			</a>

			<div class="msg-conv__slot">
				<span class="msg-conv__meta" aria-hidden="true">
					<span class="msg-conv__time">{c.lastActivityShort}</span>
					{c.unread && <span class="msg-conv__dot" />}
				</span>
				<ConversationMenu
					conversation={c}
					open={menuOpen}
					triggerClass="msg-conv__menu ui-hit"
					onToggleStar={props.onToggleStar}
					onMove={props.onMove}
					onDelete={props.onDelete}
				/>
			</div>
		</div>
	);
}
