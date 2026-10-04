import { cloneElement, type JSX, type RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import "../styles/message-interactions.css";
import { BodyPortal } from "@projective/ui/overlay";
import type { ChatMessage } from "../types/projects-types.ts";
import { placeMenu } from "../core/message-selection.ts";
import { FlagIcon, StarIcon } from "./glyphs.tsx";
import { PinIcon } from "./channel-glyphs.tsx";
import { CopyIcon, ReplyIcon } from "./chat-glyphs.tsx";
import { QUICK_EMOJI } from "./MessageActions.tsx";

/**
 * MessageContextMenu — a message's actions shown as a menu while its feed is in highlight mode (a
 * right-click, or the arrow keys with the composer unfocused). The highlight-mode form of
 * {@link MessageActions}: the same actions, labelled, with the reaction row inline.
 *
 * Portalled to `document.body` and placed with fixed coordinates beside the bubble
 * ({@link placeMenu}), because the rows around it are blurred — a filter on an ancestor would both
 * blur the menu and re-base its fixed position — and because the pop-out window's scroller would clip
 * it. It follows the bubble on scroll and resize.
 *
 * Keyboard: focus stays on the MESSAGE so the arrows keep walking the feed; Tab moves into the menu,
 * where Up/Down rove the items and Escape (or Shift+Tab off the first item) hands focus back to the
 * message. With several messages selected, Reply is shown disabled with the reason — replying to
 * several at once is not supported — and Copy copies them all; the single-message actions step aside.
 */

export interface MessageContextMenuProps {
	message: ChatMessage;
	/** How many messages are selected (this one included). */
	count: number;
	canPin: boolean;
	/** The bubble the menu sits beside. */
	anchorRef: RefObject<HTMLElement>;
	/** The message row, which takes focus back when the menu is left. */
	rowRef: RefObject<HTMLElement>;
	onReply: () => void;
	onReact: (emoji: string) => void;
	onCopy: () => void;
	onTogglePin: () => void;
	onToggleFavorite: () => void;
	onReport: () => void;
}

export function MessageContextMenu(props: MessageContextMenuProps): JSX.Element {
	const { message, count, canPin, anchorRef, rowRef } = props;
	const menuRef = useRef<HTMLDivElement>(null);
	const pos = useSignal<{ x: number; y: number } | null>(null);
	const single = count <= 1;

	// #region Placement (beside the bubble; follows scroll and resize)
	useLayoutEffect(() => {
		function place(): void {
			const anchor = anchorRef.current?.getBoundingClientRect();
			const menu = menuRef.current;
			if (!anchor || !menu) return;
			pos.value = placeMenu(
				anchor,
				{ width: menu.offsetWidth, height: menu.offsetHeight },
				message.isOwn,
				{ width: globalThis.innerWidth, height: globalThis.innerHeight },
			);
		}
		place();
		// Capture, so the pop-out window's own scroller moves the menu too.
		globalThis.addEventListener("scroll", place, true);
		globalThis.addEventListener("resize", place);
		return () => {
			globalThis.removeEventListener("scroll", place, true);
			globalThis.removeEventListener("resize", place);
		};
	}, [message.id, count]);
	// #endregion

	// #region Keyboard (Tab in from the message, rove, Escape back)
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent): void {
			const menu = menuRef.current;
			if (!menu || e.key !== "Tab" || e.shiftKey) return;
			if (document.activeElement !== rowRef.current) return;
			const first = menu.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)");
			if (!first) return;
			e.preventDefault();
			first.focus();
		}
		globalThis.addEventListener("keydown", onKeyDown);
		return () => globalThis.removeEventListener("keydown", onKeyDown);
	}, []);

	function onMenuKeyDown(e: JSX.TargetedKeyboardEvent<HTMLDivElement>): void {
		const items = Array.from(
			e.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)"),
		);
		const at = items.indexOf(document.activeElement as HTMLElement);
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const step = e.key === "ArrowDown" ? 1 : -1;
			items[(at + step + items.length) % items.length]?.focus();
		} else if (e.key === "Home" || e.key === "End") {
			e.preventDefault();
			(e.key === "Home" ? items[0] : items[items.length - 1])?.focus();
		} else if (e.key === "Escape" || (e.key === "Tab" && e.shiftKey && at <= 0)) {
			e.preventDefault();
			e.stopPropagation();
			rowRef.current?.focus({ preventScroll: true });
		}
	}
	// #endregion

	const place = pos.value;
	return (
		<BodyPortal>
			<div
				ref={menuRef}
				class="msg-cmenu"
				role="menu"
				aria-label={single ? "Message actions" : `Actions for ${count} messages`}
				data-msg-ui="true"
				data-placed={place ? "true" : undefined}
				style={place ? { "--ctx-x": `${place.x}px`, "--ctx-y": `${place.y}px` } : undefined}
				onKeyDown={onMenuKeyDown}
			>
				{single && (
					<div class="msg-cmenu__react" role="group" aria-label="React">
						{QUICK_EMOJI.map((emoji) => (
							<button
								key={emoji}
								type="button"
								role="menuitem"
								class="msg-cmenu__emoji"
								aria-label={`React with ${emoji}`}
								tabIndex={-1}
								onClick={() => props.onReact(emoji)}
							>
								{emoji}
							</button>
						))}
					</div>
				)}

				<button
					type="button"
					role="menuitem"
					class="msg-cmenu__item"
					tabIndex={-1}
					disabled={!single}
					aria-keyshortcuts="ArrowLeft ArrowRight"
					onClick={props.onReply}
				>
					<span class="msg-cmenu__icon" aria-hidden="true">{cloneElement(ReplyIcon)}</span>
					<span class="msg-cmenu__label">Reply</span>
					<span class="msg-cmenu__hint">{single ? "← →" : "One at a time"}</span>
				</button>

				<button
					type="button"
					role="menuitem"
					class="msg-cmenu__item"
					tabIndex={-1}
					aria-keyshortcuts="Control+C"
					onClick={props.onCopy}
				>
					<span class="msg-cmenu__icon" aria-hidden="true">{cloneElement(CopyIcon)}</span>
					<span class="msg-cmenu__label">{single ? "Copy" : `Copy ${count} messages`}</span>
					<span class="msg-cmenu__hint">Ctrl+C</span>
				</button>

				{single && canPin && (
					<button
						type="button"
						role="menuitem"
						class="msg-cmenu__item"
						tabIndex={-1}
						onClick={props.onTogglePin}
					>
						<span class="msg-cmenu__icon" aria-hidden="true">{cloneElement(PinIcon)}</span>
						<span class="msg-cmenu__label">{message.pinned ? "Unpin message" : "Pin message"}</span>
					</button>
				)}

				{single && (
					<button
						type="button"
						role="menuitem"
						class="msg-cmenu__item"
						tabIndex={-1}
						onClick={props.onToggleFavorite}
					>
						<span class="msg-cmenu__icon" aria-hidden="true">{cloneElement(StarIcon)}</span>
						<span class="msg-cmenu__label">
							{message.favorited ? "Remove favourite" : "Favourite"}
						</span>
					</button>
				)}

				{single && (
					<button
						type="button"
						role="menuitem"
						class="msg-cmenu__item"
						data-danger="true"
						tabIndex={-1}
						onClick={props.onReport}
					>
						<span class="msg-cmenu__icon" aria-hidden="true">{cloneElement(FlagIcon)}</span>
						<span class="msg-cmenu__label">Report</span>
					</button>
				)}
			</div>
		</BodyPortal>
	);
}
