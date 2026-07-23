import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
import { conversationHref } from "../core/conversation-model.ts";
import type { ConversationSummary } from "../types/messaging-types.ts";

/**
 * MessagesRail — the inbox sidebar's COLLAPSED presentation (a purpose-built icon rail, revealed by CSS
 * at the narrow splitter density, exactly like `ProjectRail`). Top: a New-message accent button + the
 * most-recent conversation avatars (unread dot preserved). Bottom (pinned): Settings + the Expand toggle
 * (reusing the global rail's morphing `SidebarToggleIcon`). Every control is a 48px square with a portal
 * `Tooltip` + `aria-label` (§B.6 icon-first, never native `title`).
 */

// #region Props
export interface MessagesRailProps {
	recent: ConversationSummary[];
	activeId: string | null;
	onNew: () => void;
	onSettings: () => void;
	onExpand: () => void;
}
// #endregion

export function MessagesRail(props: MessagesRailProps): JSX.Element {
	return (
		<nav class="msg-rail" aria-label="Conversations">
			<div class="msg-rail__group">
				<Tooltip content="New message" placement="right">
					<button
						type="button"
						class="msg-rail__btn msg-rail__btn--accent"
						aria-label="New message"
						onClick={props.onNew}
					>
						<MessagingIcon name="compose" />
					</button>
				</Tooltip>

				{props.recent.map((c) => (
					<Tooltip key={c.id} content={c.title} placement="right">
						<a
							class="msg-rail__btn msg-rail__btn--avatar"
							href={conversationHref(c.id)}
							aria-label={c.title}
							data-active={props.activeId === c.id ? "true" : undefined}
							data-unread={c.unread ? "true" : undefined}
						>
							<Avatar
								image={c.avatar ?? undefined}
								label={c.title}
								size={34}
								shape={c.kind === "group" ? "square" : "circle"}
							/>
						</a>
					</Tooltip>
				))}
			</div>

			<div class="msg-rail__group msg-rail__group--bottom">
				<Tooltip content="Message settings" placement="right">
					<button
						type="button"
						class="msg-rail__btn"
						aria-label="Message settings"
						onClick={props.onSettings}
					>
						<MessagingIcon name="settings" />
					</button>
				</Tooltip>
				<Tooltip content="Expand lane" placement="right">
					<button
						type="button"
						class="msg-rail__btn msg-rail__btn--toggle"
						data-collapsed="true"
						aria-label="Expand lane"
						aria-pressed="true"
						onClick={props.onExpand}
					>
						<SidebarToggleIcon />
					</button>
				</Tooltip>
			</div>
		</nav>
	);
}
