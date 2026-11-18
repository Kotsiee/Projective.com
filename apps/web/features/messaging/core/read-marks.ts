import { signal } from "@preact/signals";
import type { ConversationSummary } from "../types/messaging-types.ts";
import { MessagingService } from "./MessagingService.ts";

/**
 * read-marks — when a conversation counts as read, and how the inbox lane learns that it is.
 *
 * A read is the person having seen the latest page (CAS M10). The page's GET cannot know that (a
 * prefetch, a link unfurler, a retry or a cross-site navigation fetches it too), so it writes nothing
 * (PRD-C11). The chat island sends `POST /api/messaging/conversations/[id]/read` instead, once the
 * thread has painted in a visible tab ({@link whenSeen}).
 *
 * The lane is rendered by the same request as the thread, before that POST exists, so it paints the
 * thread's server state. This tab's marks are layered over the loaded rows ({@link withRead}), the way
 * `folder-moves` layers folder moves: set when the mark is sent, rolled back if the server refuses it.
 * The fat service drops the tenant's inbox cache when the watermark moves, so the next inbox read
 * carries the mark on its own.
 */

// #region Visibility
/** The slice of `Document` the scheduler reads: its visibility, and the event that changes it. */
export interface VisibilitySource {
	readonly visibilityState: string;
	addEventListener(type: "visibilitychange", listener: () => void): void;
	removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Run `act` once the page is visible: at once if it already is, else on the first
 * `visibilitychange` that makes it so. It runs at most once. Returns a cancel that drops the pending
 * listener (call it on unmount); cancelling after `act` has run changes nothing.
 */
export function whenSeen(doc: VisibilitySource, act: () => void): () => void {
	let settled = false;
	const check = (): void => {
		if (settled || doc.visibilityState !== "visible") return;
		settled = true;
		doc.removeEventListener("visibilitychange", check);
		act();
	};
	doc.addEventListener("visibilitychange", check);
	check();
	return () => {
		settled = true;
		doc.removeEventListener("visibilitychange", check);
	};
}
// #endregion

// #region Overlay
/** Conversations this tab has marked read, keyed by id, layered over the loaded rows. */
export const readMarks = signal<Readonly<Record<string, true>>>({});

/** The row with this tab's read mark applied: a conversation marked read carries no unread dot. */
export function withRead(
	c: ConversationSummary,
	marks: Readonly<Record<string, true>>,
): ConversationSummary {
	return c.unread && marks[c.id] ? { ...c, unread: false } : c;
}

/**
 * Mark a conversation the person has seen as read. The lane drops its dot at once; a refusal or a
 * network failure puts it back and says nothing, because unread is the safe direction. Resolves to
 * whether the server took the mark.
 */
export async function markConversationSeen(id: string): Promise<boolean> {
	readMarks.value = { ...readMarks.value, [id]: true };
	const res = await MessagingService.markRead(id);
	if (res.ok) return true;
	const rest = { ...readMarks.value };
	delete rest[id];
	readMarks.value = rest;
	return false;
}
// #endregion
