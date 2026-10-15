import type { JSX, RefObject } from "preact";
import type { Signal } from "@preact/signals";
import type { IconName } from "@projective/ui/icons";
import {
	ActionMenu,
	type ActionMenuProps,
	composeMenu,
	linkActionItems,
	type MenuItem,
} from "@projective/ui/navigation";
import { MessagingIcon } from "./messaging-glyphs.tsx";
import type { ConversationSummary, InboxFolder } from "../types/messaging-types.ts";

/**
 * ConversationMenu — the overflow (`…`) trigger and the conversation-state menu it opens, shared by the
 * lane row ({@link ConversationRow}) and the phone inbox row ({@link InboxRow}) so both offer the same
 * actions in the same order: Open · Open in new tab · Copy link (when the row has an href) · Favourite ·
 * Mute · the folder moves the row's folder allows · Delete. Right-clicking the row's `surface` opens
 * the same rows at the pointer.
 */

// #region Props
export interface ConversationMenuProps {
	conversation: ConversationSummary;
	/** The row owns the open state so it can reflect it on its own surface. */
	open: Signal<boolean>;
	/** The trigger's class — each row positions its trigger in its own layout. */
	triggerClass: string;
	/** The conversation's canonical href; omitted, the menu offers no link rows. */
	href?: string;
	/** The row element; right-click, the ContextMenu key and Shift+F10 on it open this menu. */
	surface?: ActionMenuProps["surface"];
	onToggleStar: (id: string) => void;
	onMove: (id: string, folder: InboxFolder) => void;
	onDelete: (id: string) => void;
	/** Omitted where the row does not offer muting. */
	onToggleMute?: (id: string) => void;
	/** Told whether Copy link reached the clipboard. */
	onCopied?: (ok: boolean) => void;
}
// #endregion

interface FolderMove {
	to: InboxFolder;
	label: string;
	icon: IconName;
}

const SHELL_AVOID = [".ui-app-shell__sidebar"] as const;

/** The folder moves a conversation in `folder` offers, in menu order. */
export function folderMoves(folder: InboxFolder): FolderMove[] {
	if (folder === "archived") return [{ to: "primary", label: "Unarchive", icon: "inbox" }];
	const archive: FolderMove = { to: "archived", label: "Archive", icon: "archive-box" };
	return folder === "requests"
		? [{ to: "primary", label: "Move to Primary", icon: "inbox" }, archive]
		: [archive];
}

function stateRows(props: ConversationMenuProps): MenuItem[] {
	const { conversation: c, onToggleMute } = props;
	const rows: MenuItem[] = [{
		key: "star",
		label: c.starred ? "Remove favourite" : "Favourite",
		icon: "star",
		command: () => props.onToggleStar(c.id),
	}];
	if (onToggleMute) {
		rows.push({
			key: "mute",
			label: c.muted ? "Unmute" : "Mute notifications",
			icon: c.muted ? "bell" : "bell-off",
			command: () => onToggleMute(c.id),
		});
	}
	for (const move of folderMoves(c.folder)) {
		rows.push({
			key: `move-${move.to}`,
			label: move.label,
			icon: move.icon,
			command: () => props.onMove(c.id, move.to),
		});
	}
	rows.push({
		key: "delete",
		label: "Delete conversation",
		icon: "trash",
		danger: true,
		command: () => props.onDelete(c.id),
	});
	return rows;
}

export function ConversationMenu(props: ConversationMenuProps): JSX.Element {
	const { conversation: c, href } = props;
	const model = composeMenu(
		href
			? linkActionItems({
				href,
				title: c.title,
				include: ["open", "open-new-tab", "copy-link"],
				onCopied: props.onCopied,
			})
			: [],
		stateRows(props),
	);

	return (
		<ActionMenu
			model={model}
			open={props.open}
			surface={props.surface}
			placement="bottom-end"
			avoid={SHELL_AVOID}
			aria-label={`Actions for ${c.title}`}
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
		/>
	);
}
