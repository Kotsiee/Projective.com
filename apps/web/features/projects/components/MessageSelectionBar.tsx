import { cloneElement, type JSX } from "preact";
import "../styles/message-interactions.css";
import { BodyPortal } from "@projective/ui/overlay";
import type { ChatMessage } from "../types/projects-types.ts";
import type { MessageSelection } from "../hooks/useMessageSelection.ts";
import { CloseIcon, FlagIcon, StarIcon } from "./glyphs.tsx";
import { PinIcon } from "./channel-glyphs.tsx";
import { CopyIcon, ReplyIcon } from "./chat-glyphs.tsx";

/**
 * MessageSelectionBar — the live count of selected messages, in one of two places.
 *
 * - **Desktop / tablet:** a small pill pinned at the top of the message column — "3 selected", Copy,
 *   and Clear. A COUNT with its two controls, which is exactly what containment is reserved for
 *   (DESIGN_SYSTEM.md §B.11). It sits in a zero-height sticky anchor, so appearing never pushes the
 *   feed down.
 * - **Mobile:** the WhatsApp-style action bar that REPLACES the site header while messages are being
 *   picked: close, the count, and the actions that apply — Reply only for exactly one message (never
 *   for several), Copy for any number, Pin · Favourite · Report for one. Fixed over the top bar's own
 *   slot at the top bar's own height and tone, portalled to `document.body` so no transformed or
 *   blurred ancestor can re-base it (DESIGN_SYSTEM.md §B.10).
 *
 * Both mark themselves `data-msg-ui` so a press on them is not read as a press outside the surface.
 */

export interface MessageSelectionBarProps {
	selection: MessageSelection;
	messages: readonly ChatMessage[];
	canPin: boolean;
	/** The mobile header form rather than the in-column pill. */
	mobile: boolean;
	onReply: (m: ChatMessage) => void;
	onTogglePin: (id: string) => void;
	onToggleFavorite: (id: string) => void;
	onReport: (id: string) => void;
}

export function MessageSelectionBar(props: MessageSelectionBarProps): JSX.Element | null {
	const { selection, messages, canPin, mobile } = props;
	const ids = selection.selected.value;
	if (!selection.active.value || ids.length === 0) return null;
	const count = ids.length;
	const single = count === 1 ? messages.find((m) => m.id === ids[0]) ?? null : null;
	const countLabel = `${count} selected`;

	if (!mobile) {
		return (
			<div class="msg-selbar" data-msg-ui="true">
				<div class="msg-selbar__pill" role="toolbar" aria-label="Selected messages">
					<span class="msg-selbar__count" aria-hidden="true">{countLabel}</span>
					<button
						type="button"
						class="msg-selbar__btn"
						aria-label={count > 1 ? `Copy ${count} messages` : "Copy message"}
						onClick={() => void selection.copy()}
					>
						<span class="msg-selbar__icon" aria-hidden="true">{cloneElement(CopyIcon)}</span>
						Copy
					</button>
					<button
						type="button"
						class="msg-selbar__btn msg-selbar__btn--icon"
						aria-label="Clear selection"
						onClick={() => selection.exit()}
					>
						{cloneElement(CloseIcon)}
					</button>
				</div>
			</div>
		);
	}

	return (
		<BodyPortal>
			<div
				class="msg-mbar"
				role="toolbar"
				aria-label={`${countLabel} — message actions`}
				data-msg-ui="true"
			>
				<button
					type="button"
					class="msg-mbar__btn"
					aria-label="Clear selection"
					onClick={() => selection.exit()}
				>
					{cloneElement(CloseIcon)}
				</button>
				<span class="msg-mbar__count" aria-live="polite">{count}</span>
				<span class="msg-mbar__spacer" />
				{single && (
					<button
						type="button"
						class="msg-mbar__btn"
						aria-label="Reply"
						onClick={() => props.onReply(single)}
					>
						{cloneElement(ReplyIcon)}
					</button>
				)}
				<button
					type="button"
					class="msg-mbar__btn"
					aria-label={count > 1 ? `Copy ${count} messages` : "Copy message"}
					onClick={() => {
						void selection.copy();
						selection.exit();
					}}
				>
					{cloneElement(CopyIcon)}
				</button>
				{single && canPin && (
					<button
						type="button"
						class="msg-mbar__btn"
						aria-label={single.pinned ? "Unpin message" : "Pin message"}
						aria-pressed={single.pinned}
						onClick={() => props.onTogglePin(single.id)}
					>
						{cloneElement(PinIcon)}
					</button>
				)}
				{single && (
					<button
						type="button"
						class="msg-mbar__btn"
						aria-label={single.favorited ? "Remove favourite" : "Favourite"}
						aria-pressed={single.favorited}
						onClick={() => props.onToggleFavorite(single.id)}
					>
						{cloneElement(StarIcon)}
					</button>
				)}
				{single && (
					<button
						type="button"
						class="msg-mbar__btn"
						data-danger="true"
						aria-label="Report"
						onClick={() => props.onReport(single.id)}
					>
						{cloneElement(FlagIcon)}
					</button>
				)}
			</div>
		</BodyPortal>
	);
}
