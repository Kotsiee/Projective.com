import type { SendConversationMessage } from "@projective/types/messaging";
import type {
	ChatMessage,
	MessageAttachment,
	MessagePage,
	MessageSender,
} from "@projective/types/projects";
import type { ReadActor } from "../read-actor.ts";
import { VIEWER } from "./conversation-fixtures.ts";

/**
 * messaging write store — the mutable, PER-PROCESS overlay the messaging write path keeps while
 * `MESSAGING_BACKEND_LIVE` is off. The messaging half of `../projects/write-store.ts`, and it follows
 * that module's three rules to the letter:
 *
 *  - **It is not a database.** An in-module `Map`; a restart loses everything. It exists so a sent
 *    message is still there after the browser reloads, which is the only test that matters for a
 *    write — and the one a stub that returns `ok()` and mutates nothing fails.
 *  - **An overlay, never a rewritten corpus.** The fixture conversation pool is shared module state
 *    derived from one corpus; mutating it in place would make one caller's message everybody's. So
 *    this holds the SENT rows per conversation and the read folds them over a freshly derived page.
 *  - **Scoped by owner**, keyed the same way the projects store keys its buckets, so one developer's
 *    conversation is not another session's.
 *
 * The live path replaces this file and nothing else: the shape stored is already the projection the
 * read returns, so the fat service's answer is identical either side of the gate.
 */

// #region Owner scoping
/** The per-viewer bucket key — both halves, for the same reason the projects store carries both. */
export function writeOwnerOf(actor?: ReadActor): string {
	return `${actor?.userId || "anon"}::${actor?.contextId || "personal"}`;
}

/** Sent messages per owner, keyed by conversation id, oldest first. */
const buckets = new Map<string, Map<string, ChatMessage[]>>();

function bucketFor(owner: string): Map<string, ChatMessage[]> {
	const existing = buckets.get(owner);
	if (existing) return existing;
	const fresh = new Map<string, ChatMessage[]>();
	buckets.set(owner, fresh);
	return fresh;
}

/** The bucket for an owner, or `undefined` — the read path must not create one. */
function peekBucket(owner: string): Map<string, ChatMessage[]> | undefined {
	return buckets.get(owner);
}
// #endregion

// #region Writes
/** Record a sent message against its conversation. */
export function appendConversationMessage(
	owner: string,
	conversationId: string,
	message: ChatMessage,
): void {
	const bucket = bucketFor(owner);
	const existing = bucket.get(conversationId) ?? [];
	existing.push(message);
	bucket.set(conversationId, existing);
}

/** How many messages this viewer has sent into a conversation — the id suffix a fresh one takes. */
export function sentConversationCount(owner: string, conversationId: string): number {
	return peekBucket(owner)?.get(conversationId)?.length ?? 0;
}

/** The stub path's author: the fixture corpus's own acting viewer, so the face matches the feed. */
export function stubViewerSender(): MessageSender {
	return { id: VIEWER.id, name: VIEWER.name, avatar: VIEWER.avatar, handle: VIEWER.handle };
}

/** `h:mm AM` in UTC — matches the corpus's pre-formatted clocks so SSR and the client agree. */
function clockLabel(now: number): string {
	const d = new Date(now);
	const hh = d.getUTCHours();
	const h12 = hh % 12 === 0 ? 12 : hh % 12;
	return `${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

/**
 * Build the message a stub send becomes.
 *
 * The attachment projection cannot know the file's real name from an id alone — the live read joins
 * `files.items` for that — so a stub attachment carries a positional label. The row is honest about
 * what it is: a reference to an asset the viewer attached, rendered as a file card.
 */
export function buildStubConversationMessage(
	input: SendConversationMessage,
	sender: MessageSender,
	ordinal: number,
	now: number,
): ChatMessage {
	const attachments: MessageAttachment[] = input.attachmentIds.map((id, index) => ({
		id,
		kind: "file",
		url: `/api/files/${id}`,
		name: `Attachment ${index + 1}`,
		ext: "",
		width: null,
		height: null,
	}));
	return {
		id: `sent-${input.conversationId}-${ordinal}`,
		type: "user",
		createdAt: new Date(now).toISOString(),
		timeLabel: clockLabel(now),
		dayLabel: "Today",
		sender,
		isOwn: true,
		text: input.text,
		attachments,
		audio: input.audio,
		system: null,
		reactions: [],
		pinned: false,
		favorited: false,
	};
}
// #endregion

// #region Read overlay
/**
 * Fold this viewer's sent messages onto a derived {@link MessagePage}.
 *
 * Applied to the LATEST page only: a sent message is by definition newer than anything in the
 * corpus, so it belongs at the tail of the first page and nowhere else. A row already present (the
 * live path answered, or the overlay ran twice) is not appended a second time.
 */
export function overlayConversationPage(
	page: MessagePage,
	isLatestPage: boolean,
	actor?: ReadActor,
): MessagePage {
	if (!isLatestPage) return page;
	const sent = peekBucket(writeOwnerOf(actor))?.get(page.channelId);
	if (!sent?.length) return page;
	const fresh = sent.filter((message) => !page.messages.some((m) => m.id === message.id));
	if (fresh.length === 0) return page;
	return {
		...page,
		messages: [...page.messages, ...fresh],
		total: page.total + fresh.length,
	};
}
// #endregion
