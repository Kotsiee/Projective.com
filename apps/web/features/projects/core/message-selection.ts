import { replyExcerpt } from "@projective/types/projects";
import type { ChatMessage } from "../types/projects-types.ts";
import type { MessageReplyDetail } from "@web/utils/lane-events.ts";

/**
 * message-selection — the pure model behind a feed's highlight mode: which messages the keyboard can
 * land on, where an arrow press goes, what a Shift-extended range covers, and what a copy of several
 * messages reads as. DOM-free, so the feed, the pop-out window and the tests share one definition.
 */

// #region Navigation
/**
 * The ids a reader can select, oldest → newest. Only authored messages: a system notice cannot be
 * replied to, reacted to or copied as somebody's words, so landing on one would offer a menu of
 * actions that all do nothing.
 */
export function selectableIds(messages: readonly ChatMessage[]): string[] {
	return messages.filter((m) => m.type === "user").map((m) => m.id);
}

/**
 * The id one step from `from` in `direction` (-1 older, +1 newer), clamped at both ends. `from`
 * missing from the list (it scrolled out of the loaded window, or was never set) starts at the
 * newest message, which is where a reader of a bottom-anchored feed is looking.
 */
export function stepId(
	ids: readonly string[],
	from: string | null,
	direction: -1 | 1,
): string | null {
	if (ids.length === 0) return null;
	const at = from === null ? -1 : ids.indexOf(from);
	if (at < 0) return ids[ids.length - 1];
	return ids[Math.min(ids.length - 1, Math.max(0, at + direction))];
}

/** Every id between `a` and `b` inclusive, in feed order — the span a Shift-click or Shift-arrow covers. */
export function rangeIds(ids: readonly string[], a: string, b: string): string[] {
	const i = ids.indexOf(a);
	const j = ids.indexOf(b);
	if (i < 0 || j < 0) return j >= 0 ? [b] : [];
	return ids.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** `list` with `id` added, or removed if present — a Ctrl-click. Order follows the feed, not the clicks. */
export function toggleId(ids: readonly string[], list: readonly string[], id: string): string[] {
	const next = new Set(list);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	return ids.filter((x) => next.has(x));
}
// #endregion

// #region Copy
/** What a copied message contributes when it has no text — so a copy never silently drops a row. */
function bodyForCopy(m: ChatMessage): string {
	if (m.text.trim().length > 0) return m.text;
	if (m.audio) return "[Voice message]";
	if (m.attachments.length > 0) {
		return m.attachments.length === 1
			? `[${m.attachments[0].name}]`
			: `[${m.attachments.length} attachments]`;
	}
	return "";
}

/**
 * The clipboard text for a selection.
 *
 * One message copies as its own words, exactly what the per-message Copy action yields. Several copy
 * as a transcript — each prefixed with who said it and when — because a paste of three bare
 * paragraphs loses the one thing that made them a conversation.
 */
export function clipboardText(messages: readonly ChatMessage[], ids: readonly string[]): string {
	const chosen = messages.filter((m) => ids.includes(m.id));
	if (chosen.length === 1) return bodyForCopy(chosen[0]);
	return chosen
		.map((m) => {
			const who = m.isOwn ? "You" : m.sender?.name ?? "Unknown";
			return `${who} · ${m.dayLabel} ${m.timeLabel}\n${bodyForCopy(m)}`;
		})
		.join("\n\n");
}
// #endregion

// #region Context-menu placement
/** A rectangle in viewport pixels — the subset of `DOMRect` placement reads. */
export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** Breathing room between the menu, its bubble and the viewport edge (px). */
const MENU_GAP = 8;

/**
 * Where a message's context menu goes, in viewport pixels.
 *
 * Beside the bubble first — on the side away from the author's alignment, so it opens into the empty
 * half of the row — top-aligned with it and slid up to stay on screen. When the row has no room
 * beside the bubble (a phone, the narrow pop-out window, a wide image) it drops below the bubble's
 * edge instead, and above it when below would leave the viewport.
 */
export function placeMenu(
	anchor: Box,
	menu: { width: number; height: number },
	own: boolean,
	viewport: { width: number; height: number },
): { x: number; y: number } {
	const maxX = viewport.width - menu.width - MENU_GAP;
	const maxY = viewport.height - menu.height - MENU_GAP;
	const beside = own ? anchor.left - MENU_GAP - menu.width : anchor.right + MENU_GAP;
	if (beside >= MENU_GAP && beside <= maxX) {
		return { x: beside, y: Math.max(MENU_GAP, Math.min(anchor.top, maxY)) };
	}
	const x = Math.max(MENU_GAP, Math.min(own ? anchor.right - menu.width : anchor.left, maxX));
	const below = anchor.bottom + MENU_GAP;
	const y = below <= maxY ? below : Math.max(MENU_GAP, anchor.top - MENU_GAP - menu.height);
	return { x, y };
}
// #endregion

// #region Reply target
/** The quote a reply to `m` carries — what the composer's strip shows before the reply exists. */
export function replyTargetOf(m: ChatMessage): MessageReplyDetail["target"] {
	return {
		id: m.id,
		senderName: m.sender?.name ?? null,
		isOwn: m.isOwn,
		excerpt: replyExcerpt(m.text),
		media: m.audio ? "audio" : m.attachments.length > 0 ? "attachment" : "none",
	};
}
// #endregion
