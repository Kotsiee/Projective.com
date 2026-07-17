import type { ChatMessage } from "../types/projects-types.ts";

/**
 * message-model — the pure, DOM-free model behind the channel chat feed. It turns the ordered
 * {@link ChatMessage} page into the flat list of feed ROWS the virtualizer renders (day dividers +
 * grouped message rows) and derives the consecutive-message grouping flags the bubbles read (avatar/
 * name visibility, reduced separation, and corner masking). Kept side-effect-free so SSR and the island
 * derive identical rows.
 */

// #region Grouping tunables
/**
 * Consecutive messages from the same author within this gap collapse into one visual group (reduced
 * separation, one avatar/name, corner masking). The task's "10–30 minute window" — 15 min sits in the
 * middle so a quick back-and-forth groups while a resumed conversation later starts a fresh group.
 */
export const GROUP_WINDOW_MS = 15 * 60 * 1000;
// #endregion

// #region Row model
/** A message's position within its same-author group — drives spacing + corner masking. */
export type GroupPosition = "single" | "first" | "middle" | "last";

/** One rendered message row (a bubble or a system notice) with its derived grouping flags. */
export interface MessageRow {
	kind: "message";
	/** Stable key for virtualization (the message id) — survives head-prepends. */
	key: string;
	message: ChatMessage;
	/** First of a same-author run → the row that shows the avatar + name. */
	firstOfGroup: boolean;
	/** Last of a same-author run → the row the group's tail spacing hangs off. */
	lastOfGroup: boolean;
	groupPos: GroupPosition;
}

/** A date separator between two days of messages. */
export interface DividerRow {
	kind: "divider";
	key: string;
	day: string;
}

export type FeedRow = MessageRow | DividerRow;
// #endregion

// #region Builders
/** Whether `b` (which immediately follows `a`) belongs to the same visual group as `a`. */
function sameGroup(a: ChatMessage, b: ChatMessage): boolean {
	// Only authored bubbles group; a system notice always stands alone and breaks the run.
	if (a.type !== "user" || b.type !== "user") return false;
	if (a.isOwn !== b.isOwn) return false;
	if ((a.sender?.id ?? "") !== (b.sender?.id ?? "")) return false;
	const gap = Date.parse(b.createdAt) - Date.parse(a.createdAt);
	return gap >= 0 && gap <= GROUP_WINDOW_MS;
}

/**
 * Build the ordered feed rows from a page of messages (oldest→newest): a day divider whenever the day
 * label changes, then each message tagged with its group flags. A day boundary always breaks a group
 * (metadata shows again under the new divider).
 */
export function buildRows(messages: ChatMessage[]): FeedRow[] {
	const rows: FeedRow[] = [];
	let lastDay: string | null = null;
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m.dayLabel !== lastDay) {
			rows.push({ kind: "divider", key: `div-${m.dayLabel}-${m.id}`, day: m.dayLabel });
			lastDay = m.dayLabel;
		}
		const prev = messages[i - 1];
		const next = messages[i + 1];
		const prevSame = !!prev && prev.dayLabel === m.dayLabel && sameGroup(prev, m);
		const nextSame = !!next && next.dayLabel === m.dayLabel && sameGroup(m, next);
		const firstOfGroup = !prevSame;
		const lastOfGroup = !nextSame;
		const groupPos: GroupPosition = firstOfGroup && lastOfGroup
			? "single"
			: firstOfGroup
			? "first"
			: lastOfGroup
			? "last"
			: "middle";
		rows.push({ kind: "message", key: m.id, message: m, firstOfGroup, lastOfGroup, groupPos });
	}
	return rows;
}

/** The row index of a message by id (for pinned jump-to-message), or -1 when not in the loaded window. */
export function rowIndexOfMessage(rows: FeedRow[], messageId: string): number {
	return rows.findIndex((r) => r.kind === "message" && r.message.id === messageId);
}

/** A rough per-row size estimate (px) for the virtualizer before real measurement refines it. */
export function estimateRowSize(row: FeedRow): number {
	if (row.kind === "divider") return 44;
	const m = row.message;
	if (m.type === "system") return 40;
	let h = row.firstOfGroup ? 46 : 26; // meta row adds height on the first of a group
	if (m.text) h += Math.min(120, 20 + Math.ceil(m.text.length / 42) * 20);
	if (m.audio) h += 44;
	if (m.attachments.length > 0) h += 220;
	if (m.reactions.length > 0) h += 26;
	return h;
}
// #endregion
