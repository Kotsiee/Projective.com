import { getProjects } from "./api.ts";
import type { MessagePage } from "../types/projects-types.ts";
import type { ProjectsResult } from "../types/results.ts";

/**
 * MessagesService — the THIN client controller for a channel's conversation feed.
 *
 * A dumb object of named methods; each builds a query string and forwards to `/api/projects/messages`,
 * returning a soft {@link ProjectsResult}. No fixtures, no query logic — the fat
 * {@link ProjectBackendService} owns the read; the chat feed island calls these for the initial refine
 * and for load-on-scroll-up pagination (mirrors {@link ProjectSidebarService}).
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
};
