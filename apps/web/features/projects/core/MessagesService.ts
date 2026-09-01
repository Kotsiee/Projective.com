import { getProjects, postProjects } from "./api.ts";
import type { ChatMessage, MessagePage, SendProjectMessage } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * MessagesService — the THIN client controller for a channel's conversation.
 *
 * A dumb object of named methods; each builds a query string or a JSON body and forwards to
 * `/api/projects/messages*`, returning a soft {@link ProjectsResult}. No fixtures, no query logic —
 * the fat {@link ProjectBackendService} owns the read and the write; the chat feed island calls these
 * for the initial refine, for load-on-scroll-up pagination, and for sending (mirrors
 * {@link ProjectSidebarService}).
 */
export const MessagesService = {
	/**
	 * Fetch a page of a channel's messages. Omit `before` for the latest page; pass a `nextCursor` as
	 * `before` to load the strictly-older page when the viewer scrolls up.
	 */
	page(
		projectId: string,
		channelId: string,
		before?: string | null,
	): Promise<ProjectsResult<{ page: MessagePage }>> {
		const qs = new URLSearchParams({ projectId, channelId });
		if (before) qs.set("before", before);
		return getProjects<{ page: MessagePage }>(`/api/projects/messages?${qs.toString()}`);
	},

	/**
	 * Send one composer payload.
	 *
	 * Attachments travel as `files.items` ids, already uploaded through the files handshake — see
	 * {@link uploadForProject}, which is the one implementation of it. Bytes never reach this call, so
	 * a 500 MB attachment and a one-line note are the same request as far as the transport is
	 * concerned.
	 *
	 * Resolves with the PERSISTED message, ids and timestamps assigned. Nothing is drawn optimistically:
	 * the caller announces this row on `MESSAGE_SENT_EVENT` and the feed appends it, so what the sender
	 * sees is what was actually stored.
	 */
	send(payload: SendProjectMessage): Promise<ProjectsResult<{ message: ChatMessage }>> {
		return postProjects<{ message: ChatMessage }>("/api/projects/messages/send", payload);
	},
};
