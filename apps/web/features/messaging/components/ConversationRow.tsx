import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Avatar } from "@projective/ui/display";
import { Popover } from "@projective/ui/feedback";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import type { ConversationSummary } from "../types/messaging-types.ts";

/**
 * ConversationRow — one conversation in the inbox sidebar list (`/messages`). The whole row is an anchor
 * into the conversation (`/messages/{id}`); a trailing kebab (a sibling of the anchor, not nested) opens
 * the conversation-state actions (Favourite · Archive · Soft-delete, task §2A). Icon-led + truncated per
 * the icon-first density rule (DESIGN_SYSTEM.md §B.6): avatar · name + time · preview + a pulsing unread
 * dot (never a count).
 */

// #region Props
export interface ConversationRowProps {
	conversation: ConversationSummary;
	href: string;
	active: boolean;
	onToggleStar: (id: string) => void;
	onToggleArchive: (id: string) => void;
	onDelete: (id: string) => void;
}
// #endregion

/** The global site sidebar the kebab's `bottom-end` menu must never slide under. */
const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

export function ConversationRow(props: ConversationRowProps): JSX.Element {
	const { conversation: c, href, active } = props;
	const menuOpen = useSignal(false);

	return (
		<div
			class="msg-conv"
			data-active={active ? "true" : undefined}
			data-unread={c.unread ? "true" : undefined}
		>
			<a class="msg-conv__link" href={href} aria-current={active ? "page" : undefined}>
				<span class="msg-conv__avatar">
					<Avatar
						image={c.avatar ?? undefined}
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
					<span class="msg-conv__top">
						<span class="msg-conv__name">{c.title}</span>
						<span class="msg-conv__time">{c.lastActivityLabel}</span>
					</span>
					<span class="msg-conv__bottom">
						<span class="msg-conv__preview">{c.preview || "No messages yet"}</span>
						{c.unread && <span class="msg-conv__dot" aria-label="Unread" />}
					</span>
				</span>
			</a>

			<Popover
				open={menuOpen}
				placement="bottom-end"
				class="conv-menu-pop"
				avoid={SHELL_AVOID}
				trigger={(api) => (
					<button
						type="button"
						ref={api.ref as RefObject<HTMLButtonElement>}
						class="msg-conv__kebab"
						data-open={api.expanded ? "true" : undefined}
						aria-haspopup="menu"
						aria-label={`Actions for ${c.title}`}
						aria-expanded={api.expanded}
						aria-controls={api.panelId}
						onClick={api.toggle}
					>
						<MessagingIcon name="kebab" />
					</button>
				)}
			>
				<div class="conv-menu" role="menu" aria-label={`Actions for ${c.title}`}>
					<button
						type="button"
						role="menuitemcheckbox"
						aria-checked={c.starred}
						class="conv-menu__item"
						onClick={() => {
							props.onToggleStar(c.id);
							menuOpen.value = false;
						}}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name="star" />
						</span>
						<span>{c.starred ? "Remove favourite" : "Favourite"}</span>
					</button>
					<button
						type="button"
						role="menuitem"
						class="conv-menu__item"
						onClick={() => {
							props.onToggleArchive(c.id);
							menuOpen.value = false;
						}}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name={c.archived ? "unarchive" : "archive"} />
						</span>
						<span>{c.archived ? "Unarchive" : "Archive"}</span>
					</button>
					<button
						type="button"
						role="menuitem"
						class="conv-menu__item"
						data-danger="true"
						onClick={() => {
							props.onDelete(c.id);
							menuOpen.value = false;
						}}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name="trash" />
						</span>
						<span>Delete conversation</span>
					</button>
				</div>
			</Popover>
		</div>
	);
}
