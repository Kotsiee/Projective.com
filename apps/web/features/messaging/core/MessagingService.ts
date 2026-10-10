import { getMessaging, postMessaging } from "./api.ts";
import type {
	ChatMessage,
	ContactList,
	ConversationContext,
	ConversationDetail,
	ConversationFolderSet,
	ConversationListPage,
	ConversationListParams,
	GroupPhotoInput,
	GroupPhotoSet,
	InboxFolder,
	MessagePage,
	MessagingRole,
	MessagingSettings,
	SendConversationMessage,
} from "../types/messaging-types.ts";
import type { MessagingResult } from "../types/results.ts";
import type { AttachmentSource } from "@projective/types/projects";

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
	if (params.folder) qs.set("folder", params.folder);
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

	/**
	 * Persist the Message Settings and receive them back AS STORED. The server's copy can differ from
	 * what was sent — new auto-response rules get real ids, and `groupActivity` / `serviceInquiries`
	 * share one stored switch — so a caller should adopt `data.settings` rather than its own draft.
	 */
	saveSettings(
		settings: MessagingSettings,
	): Promise<MessagingResult<{ settings: MessagingSettings }>> {
		return postMessaging<{ settings: MessagingSettings }>("/api/messaging/settings", settings);
	},

	/**
	 * Post one message into a conversation and receive the persisted row.
	 *
	 * The messaging twin of the projects `MessagesService.send`, and the endpoint the shared
	 * `ChatComposer` posts to in its `conversation` scope — the profile's floating messenger, the
	 * pop-out chat and `/messages/[conversationId]` all send through it. The row that comes back is
	 * the SERVER's message (its real id and timestamp), which the caller announces on
	 * `MESSAGE_SENT_EVENT` so every feed on the page appends what was actually stored.
	 */
	send(payload: SendConversationMessage): Promise<MessagingResult<{ message: ChatMessage }>> {
		return postMessaging<{ message: ChatMessage }>("/api/messaging/messages/send", payload);
	},

	/** Move a conversation between the viewer's own folders (Primary · Requests · Archived). */
	/** Set a group's photo from a library still + crop, or clear it with `null`. */
	setGroupPhoto(
		id: string,
		photo: GroupPhotoInput | null,
	): Promise<MessagingResult<GroupPhotoSet>> {
		return postMessaging<GroupPhotoSet>(
			`/api/messaging/conversations/${encodeURIComponent(id)}/photo`,
			{ photo },
		);
	},

	setFolder(id: string, folder: InboxFolder): Promise<MessagingResult<ConversationFolderSet>> {
		return postMessaging<ConversationFolderSet>(
			`/api/messaging/conversations/${encodeURIComponent(id)}/folder`,
			{ folder },
		);
	},

	/**
	 * The messages a `files.items` asset was posted in, newest first — the preview modal's source
	 * message and its "Go to message" target. Narrowed to one conversation when `conversationId` is
	 * given. Resolves `[]` on any failure: the source is supplementary context the modal has already
	 * painted from the file row, never a reason to surface an error.
	 */
	async attachmentSource(
		assetId: string,
		conversationId?: string | null,
	): Promise<AttachmentSource[]> {
		const qs = new URLSearchParams({ assetId });
		if (conversationId) qs.set("conversationId", conversationId);
		const result = await getMessaging<{ sources: AttachmentSource[] }>(
			`/api/messaging/attachment-source?${qs.toString()}`,
		);
		return result.ok && result.data ? result.data.sources : [];
	},

	/** The conversation context drawer's read: the counterpart, the requests, the actions. */
	context(id: string): Promise<MessagingResult<{ context: ConversationContext }>> {
		return getMessaging<{ context: ConversationContext }>(
			`/api/messaging/conversations/${encodeURIComponent(id)}/context`,
		);
	},
};
