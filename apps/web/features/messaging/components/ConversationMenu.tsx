import type { JSX, RefObject } from "preact";
import type { Signal } from "@preact/signals";
import { Popover } from "@projective/ui/feedback";
import { MessagingIcon, type MessagingIconName } from "./messaging-glyphs.tsx";
import type { ConversationSummary, InboxFolder } from "../types/messaging-types.ts";

/**
 * ConversationMenu — the overflow (`…`) trigger and the conversation-state menu it opens, shared by the
 * lane row ({@link ConversationRow}) and the phone inbox row ({@link InboxRow}) so both offer the same
 * actions in the same order: Favourite · Mute · the folder moves the row's folder allows · Delete.
 */

// #region Props
export interface ConversationMenuProps {
	conversation: ConversationSummary;
	/** The row owns the open state so it can reflect it on its own surface. */
	open: Signal<boolean>;
	/** The trigger's class — each row positions its trigger in its own layout. */
	triggerClass: string;
	onToggleStar: (id: string) => void;
	onMove: (id: string, folder: InboxFolder) => void;
	onDelete: (id: string) => void;
	/** Omitted where the row does not offer muting. */
	onToggleMute?: (id: string) => void;
}
// #endregion

interface FolderMove {
	to: InboxFolder;
	label: string;
	icon: MessagingIconName;
}

const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

/** The folder moves a conversation in `folder` offers, in menu order. */
export function folderMoves(folder: InboxFolder): FolderMove[] {
	if (folder === "archived") return [{ to: "primary", label: "Unarchive", icon: "unarchive" }];
	const archive: FolderMove = { to: "archived", label: "Archive", icon: "archive" };
	return folder === "requests"
		? [{ to: "primary", label: "Move to Primary", icon: "inbox" }, archive]
		: [archive];
}

export function ConversationMenu(props: ConversationMenuProps): JSX.Element {
	const { conversation: c, open } = props;
	const run = (action: () => void) => () => {
		action();
		open.value = false;
	};

	return (
		<Popover
			open={open}
			placement="bottom-end"
			class="conv-menu-pop"
			avoid={SHELL_AVOID}
			trigger={(api) => (
				<button
					type="button"
					ref={api.ref as RefObject<HTMLButtonElement>}
					class={props.triggerClass}
					data-open={api.expanded ? "true" : undefined}
					aria-haspopup="menu"
					aria-label={`Actions for ${c.title}`}
					aria-expanded={api.expanded}
					aria-controls={api.panelId}
					onClick={api.toggle}
				>
					<MessagingIcon name="meatball" />
				</button>
			)}
		>
			<div class="conv-menu" role="menu" aria-label={`Actions for ${c.title}`}>
				<button
					type="button"
					role="menuitemcheckbox"
					aria-checked={c.starred}
					class="conv-menu__item"
					onClick={run(() => props.onToggleStar(c.id))}
				>
					<span class="conv-menu__icon" aria-hidden="true">
						<MessagingIcon name="star" />
					</span>
					<span>{c.starred ? "Remove favourite" : "Favourite"}</span>
				</button>
				{props.onToggleMute && (
					<button
						type="button"
						role="menuitemcheckbox"
						aria-checked={c.muted}
						class="conv-menu__item"
						onClick={run(() => props.onToggleMute?.(c.id))}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name="mute" />
						</span>
						<span>{c.muted ? "Unmute" : "Mute notifications"}</span>
					</button>
				)}
				{folderMoves(c.folder).map((move) => (
					<button
						key={move.to}
						type="button"
						role="menuitem"
						class="conv-menu__item"
						onClick={run(() => props.onMove(c.id, move.to))}
					>
						<span class="conv-menu__icon" aria-hidden="true">
							<MessagingIcon name={move.icon} />
						</span>
						<span>{move.label}</span>
					</button>
				))}
				<button
					type="button"
					role="menuitem"
					class="conv-menu__item"
					data-danger="true"
					onClick={run(() => props.onDelete(c.id))}
				>
					<span class="conv-menu__icon" aria-hidden="true">
						<MessagingIcon name="trash" />
					</span>
					<span>Delete conversation</span>
				</button>
			</div>
		</Popover>
	);
}
