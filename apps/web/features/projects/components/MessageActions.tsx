import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Popover, Tooltip } from "@projective/ui/feedback";
import type { ChatMessage } from "../types/projects-types.ts";
import { KebabIcon, StarIcon, FlagIcon } from "./glyphs.tsx";
import { PinIcon } from "./channel-glyphs.tsx";
import { CopyIcon, ReactIcon, ReplyIcon } from "./chat-glyphs.tsx";

/**
 * MessageActions — the on-hover quick actions + overflow menu for a message bubble (task §3). The
 * toolbar (Reply · React · Copy) and the meatball (`…`) trigger are absolutely positioned by the
 * bubble's CSS so revealing them never reflows the feed (no layout shift). The meatball opens a Popover
 * with Pin · Favourite · Report; React opens a small emoji quick-picker.
 *
 * Pin permission (task §3): `canPin` is server-derived — anyone in a private DM, but only an
 * owner-granted viewer in a project/team channel — so the Pin item is hidden when the viewer cannot pin.
 * Copy is real (`navigator.clipboard`); the rest are optimistic/stubbed until the messaging backend
 * lands behind `PROJECTS_BACKEND_LIVE`. `onOpenChange` lets the bubble keep the toolbar visible while a
 * menu is open (the row has lost `:hover` to the portaled panel).
 */

export interface MessageActionsProps {
	message: ChatMessage;
	/** Whether the viewer may pin in this channel (gates the Pin menu item). */
	canPin: boolean;
	own: boolean;
	onReply: () => void;
	onReact: (emoji: string) => void;
	onTogglePin: () => void;
	onToggleFavorite: () => void;
	onReport: () => void;
	/** Fired when any owned popover opens/closes so the parent can pin the toolbar visible. */
	onOpenChange: (open: boolean) => void;
}

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "✅"];

export function MessageActions(props: MessageActionsProps): JSX.Element {
	const { message, canPin, own, onReply, onReact, onTogglePin, onToggleFavorite, onReport } = props;
	const reactOpen = useSignal(false);
	const menuOpen = useSignal(false);

	function notify(): void {
		props.onOpenChange(reactOpen.value || menuOpen.value);
	}

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard?.writeText(message.text || "");
		} catch { /* clipboard blocked — non-fatal */ }
	}

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
				<button type="button" class="msg-actions__btn" aria-label="Copy message" onClick={copy}>
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
							<span class="msg-menu__label">{message.pinned ? "Unpin message" : "Pin message"}</span>
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
