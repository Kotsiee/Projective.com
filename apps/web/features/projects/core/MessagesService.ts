import { deleteProjects, getProjects, postProjects, signalProjects } from "./api.ts";
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

	/**
	 * Mark the conversation this chat shows read for the viewer (PROJECTS CH3), named as {@link send}
	 * names it: a room's own mark, or a `cht-` thread's watermark, which clears the inbox's dot too.
	 * Sent by the chat island once the page has painted in a visible tab, never by a GET (PRD-C11).
	 */
	markRead(projectId: string, channelId: string): Promise<ProjectsResult<null>> {
		return signalProjects("/api/projects/messages/read", { projectId, channelId });
	},

	/**
	 * Open the viewer's conversation with a project member inside the project, bringing it into the
	 * project's Private Messages group first when it is not there (Decision #560). Resolves with the
	 * thread's `cht-` address to open at `/projects/:projectId/:ref`.
	 */
	bringDm(
		projectId: string,
		handle: string,
	): Promise<ProjectsResult<{ ref: string; moved: boolean }>> {
		return postProjects<{ ref: string; moved: boolean }>("/api/projects/messages/dm", {
			projectId,
			handle,
		});
	},

	/** Take a conversation out of the project's Private Messages group, for both people (Decision #560). */
	takeDmOut(
		projectId: string,
		conversationId: string,
	): Promise<ProjectsResult<{ moved: boolean }>> {
		return deleteProjects<{ moved: boolean }>("/api/projects/messages/dm", {
			projectId,
			conversationId,
		});
	},
};
