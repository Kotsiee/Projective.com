import { getMessaging, postMessaging } from "./api.ts";
import type {
	ContactList,
	ConversationDetail,
	ConversationListPage,
	ConversationListParams,
	MessagePage,
	MessagingRole,
	MessagingSettings,
} from "../types/messaging-types.ts";
import type { MessagingResult } from "../types/results.ts";

/**
 * MessagingService — the THIN client controller for the global inbox (`/messages`).
 *
 * A dumb object of named methods; each builds a query string / payload and forwards to
 * `/api/messaging/*`, returning a soft {@link MessagingResult}. No fixtures, no query logic — the fat
 * {@link MessagingBackendService} owns the reads; the sidebar / conversation / settings islands call
 * these for their refines and mutations (mirrors `ProjectSidebarService` / `MessagesService`).
 */

/** Serialise the conversation-list params into the `/api/messaging/conversations` query string. */
export function buildConversationQuery(params: ConversationListParams): string {
	const qs = new URLSearchParams();
	if (params.q) qs.set("q", params.q);
	if (params.view) qs.set("view", params.view);
	if (params.unread) qs.set("unread", "1");
	if (params.role) qs.set("role", params.role);
	if (params.cursor) qs.set("cursor", params.cursor);
	if (params.limit) qs.set("limit", String(params.limit));
	const f = params.filter;
	if (f) {
		for (const r of f.relations ?? []) qs.append("rel", r);
		for (const s of f.serviceIds ?? []) qs.append("svc", s);
		for (const p of f.productIds ?? []) qs.append("prod", p);
		for (const e of f.entityIds ?? []) qs.append("entity", e);
		for (const m of f.memberIds ?? []) qs.append("member", m);
	}
	return qs.toString();
}

export const MessagingService = {
	/** Fetch a filtered, paged page of inbox conversations. */
	conversations(
		params: ConversationListParams,
	): Promise<MessagingResult<{ page: ConversationListPage }>> {
		const qs = buildConversationQuery(params);
		return getMessaging<{ page: ConversationListPage }>(
			`/api/messaging/conversations${qs ? `?${qs}` : ""}`,
		);
	},

	/** Fetch one conversation's metadata (the view header + Members tab). */
	conversation(id: string): Promise<MessagingResult<{ detail: ConversationDetail }>> {
		const qs = new URLSearchParams({ id });
		return getMessaging<{ detail: ConversationDetail }>(
			`/api/messaging/conversation?${qs.toString()}`,
		);
	},

	/**
	 * Fetch a page of a conversation's messages. Omit `before` for the latest page; pass a `nextCursor`
	 * as `before` to load the strictly-older page when the viewer scrolls up.
	 */
	messages(
		conversationId: string,
		before?: string | null,
	): Promise<MessagingResult<{ page: MessagePage }>> {
		const qs = new URLSearchParams({ conversationId });
		if (before) qs.set("before", before);
		return getMessaging<{ page: MessagePage }>(`/api/messaging/messages?${qs.toString()}`);
	},

	/** Fetch the pickable contacts for New Conversation / Add Members. */
	contacts(role?: MessagingRole, q?: string): Promise<MessagingResult<{ contacts: ContactList }>> {
		const qs = new URLSearchParams();
		if (role) qs.set("role", role);
		if (q) qs.set("q", q);
		return getMessaging<{ contacts: ContactList }>(
			`/api/messaging/contacts${qs.toString() ? `?${qs.toString()}` : ""}`,
		);
	},

	/** Fetch the Message Settings projection for the acting view. */
	settings(role?: MessagingRole): Promise<MessagingResult<{ settings: MessagingSettings }>> {
		const qs = new URLSearchParams();
		if (role) qs.set("role", role);
		return getMessaging<{ settings: MessagingSettings }>(
			`/api/messaging/settings${qs.toString() ? `?${qs.toString()}` : ""}`,
		);
	},

	/**
	 * Create a conversation from the picked contacts (stub — persistence lands with the backend).
	 *
	 * `message` is the OPENING message, for flows that create a conversation and say something in the
	 * same act — a listing's "Message seller" inquiry, where the buyer has already typed their question
	 * before any thread exists. It is part of the payload rather than a follow-up call because a create
	 * that succeeds and a send that fails would leave an empty thread and a lost question, which is the
	 * exact failure this parameter exists to prevent. Transport is stubbed behind
	 * `MESSAGING_BACKEND_LIVE`; the payload is not (the Decision #66 rule).
	 */
	create(
		payload: { contactIds: string[]; groupName?: string; message?: string },
	): Promise<MessagingResult<{ id: string }>> {
		return postMessaging<{ id: string }>("/api/messaging/conversations", payload);
	},

	/** Persist the Message Settings (stub — persistence lands with the backend). */
	saveSettings(settings: MessagingSettings): Promise<MessagingResult<{ ok: true }>> {
		return postMessaging<{ ok: true }>("/api/messaging/settings", settings);
	},
};
