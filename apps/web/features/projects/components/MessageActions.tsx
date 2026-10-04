import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Popover, Tooltip } from "@projective/ui/feedback";
import type { ChatMessage } from "../types/projects-types.ts";
import { FlagIcon, KebabIcon, StarIcon } from "./glyphs.tsx";
import { PinIcon } from "./channel-glyphs.tsx";
import { CopyIcon, ReactIcon, ReplyIcon } from "./chat-glyphs.tsx";
import { makeId } from "../core/composer-model.ts";
import { MESSAGE_MENU_OPEN_EVENT, type MessageMenuOpenDetail } from "@web/utils/lane-events.ts";

/**
 * MessageActions — the on-hover quick actions + overflow menu for a message bubble (task §3).
 *
 * A GHOST toolbar (Reply · React · Copy · `…`) that sits literally beside the bubble, in the row's
 * side rail, with the viewer's own sent time directly beneath it. No fill, no border, no shadow: the
 * buttons are the only interactive surface, so only they take a tint, on hover. The rail is always in
 * the layout and only its opacity changes, so revealing it never reflows the feed.
 *
 * The meatball opens a Popover with Pin · Favourite · Report; React opens a small emoji quick-picker.
 * In highlight mode the same actions render as {@link MessageContextMenu} instead, and the feed hides
 * this toolbar, so a message never shows two menus.
 *
 * "One message menu at a time" holds across the page: opening either popover announces itself on
 * {@link MESSAGE_MENU_OPEN_EVENT}, and an open one closes when it hears another menu open — the
 * pop-out window and the page feed are different islands, so no shared signal could do this.
 *
 * Pin permission (task §3): `canPin` is server-derived — anyone in a private DM, but only an
 * owner-granted viewer in a project/team channel — so the Pin item is hidden when the viewer cannot
 * pin. `onOpenChange` lets the bubble keep the toolbar visible while a menu is open (the row has lost
 * `:hover` to the portaled panel).
 */

export interface MessageActionsProps {
	message: ChatMessage;
	/** Whether the viewer may pin in this channel (gates the Pin menu item). */
	canPin: boolean;
	own: boolean;
	onReply: () => void;
	onReact: (emoji: string) => void;
	onCopy: () => void;
	onTogglePin: () => void;
	onToggleFavorite: () => void;
	onReport: () => void;
	/** Fired when any owned popover opens/closes so the parent can pin the toolbar visible. */
	onOpenChange: (open: boolean) => void;
}

/** The quick reactions offered everywhere a message can be reacted to. */
export const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "✅"] as const;

export function MessageActions(props: MessageActionsProps): JSX.Element {
	const {
		message,
		canPin,
		own,
		onReply,
		onReact,
		onCopy,
		onTogglePin,
		onToggleFavorite,
		onReport,
	} = props;
	const reactOpen = useSignal(false);
	const menuOpen = useSignal(false);
	const owner = useRef(makeId("msg-actions"));

	function notify(): void {
		const open = reactOpen.value || menuOpen.value;
		if (open) {
			globalThis.dispatchEvent(
				new CustomEvent<MessageMenuOpenDetail>(MESSAGE_MENU_OPEN_EVENT, {
					detail: { owner: owner.current },
				}),
			);
		}
		props.onOpenChange(open);
	}

	useEffect(() => {
		function onOtherMenu(e: Event): void {
			if ((e as CustomEvent<MessageMenuOpenDetail>).detail?.owner === owner.current) return;
			if (!reactOpen.value && !menuOpen.value) return;
			reactOpen.value = false;
			menuOpen.value = false;
			props.onOpenChange(false);
		}
		globalThis.addEventListener(MESSAGE_MENU_OPEN_EVENT, onOtherMenu);
		return () => globalThis.removeEventListener(MESSAGE_MENU_OPEN_EVENT, onOtherMenu);
	}, []);

	return (
		<div class="msg-actions" data-own={own ? "true" : undefined}>
			<Tooltip content="Reply" placement="top">
				<button type="button" class="msg-actions__btn" aria-label="Reply" onClick={onReply}>
					{ReplyIcon}
				</button>
			</Tooltip>

			<Popover
				open={reactOpen}
				placement="top"
				allowOverflow={["top"]}
				class="msg-react-pop"
				onOpenChange={() => notify()}
				trigger={(api) => (
					<Tooltip content="Add reaction" placement="top">
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="msg-actions__btn"
							aria-label="Add reaction"
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							{ReactIcon}
						</button>
					</Tooltip>
				)}
			>
				<div class="msg-react" role="menu" aria-label="Add reaction">
					{QUICK_EMOJI.map((e) => (
						<button
							key={e}
							type="button"
							role="menuitem"
							class="msg-react__emoji"
							onClick={() => {
								onReact(e);
								reactOpen.value = false;
							}}
						>
							{e}
						</button>
					))}
				</div>
			</Popover>

			<Tooltip content="Copy" placement="top">
				<button type="button" class="msg-actions__btn" aria-label="Copy message" onClick={onCopy}>
					{CopyIcon}
				</button>
			</Tooltip>

			<Popover
				open={menuOpen}
				placement="bottom-end"
				class="msg-menu-pop"
				onOpenChange={() => notify()}
				trigger={(api) => (
					<Tooltip content="More" placement="top">
						<button
							type="button"
							ref={api.ref as RefObject<HTMLButtonElement>}
							class="msg-actions__btn"
							aria-label="More actions"
							aria-haspopup="menu"
							aria-expanded={api.expanded}
							aria-controls={api.panelId}
							onClick={api.toggle}
						>
							{KebabIcon}
						</button>
					</Tooltip>
				)}
			>
				<div class="msg-menu" role="menu" aria-label="Message actions">
					{canPin && (
						<button
							type="button"
							role="menuitem"
							class="msg-menu__item"
							onClick={() => {
								onTogglePin();
								menuOpen.value = false;
							}}
						>
							<span class="msg-menu__icon" aria-hidden="true">{PinIcon}</span>
							<span class="msg-menu__label">
								{message.pinned ? "Unpin message" : "Pin message"}
							</span>
						</button>
					)}
					<button
						type="button"
						role="menuitem"
						class="msg-menu__item"
						onClick={() => {
							onToggleFavorite();
							menuOpen.value = false;
						}}
					>
						<span class="msg-menu__icon" aria-hidden="true">{StarIcon}</span>
						<span class="msg-menu__label">
							{message.favorited ? "Remove favourite" : "Favourite"}
						</span>
					</button>
					<button
						type="button"
						role="menuitem"
						class="msg-menu__item"
						data-danger="true"
						onClick={() => {
							onReport();
							menuOpen.value = false;
						}}
					>
						<span class="msg-menu__icon" aria-hidden="true">{FlagIcon}</span>
						<span class="msg-menu__label">Report</span>
					</button>
				</div>
			</Popover>
		</div>
	);
}
