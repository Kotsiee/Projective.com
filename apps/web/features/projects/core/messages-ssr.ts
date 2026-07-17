import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { MessagePage } from "../types/projects-types.ts";

/**
 * messages-ssr — the SERVER-ONLY bootstrap the Chat tab uses to paint the message feed's first byte on
 * `/projects/[projectId]/[channelId]/chat`. It resolves the LATEST {@link MessagePage} straight from the
 * fat {@link ProjectBackendService} (no HTTP hop — exactly as the feed/detail SSR their first paint), so
 * the feed hydrates with zero client round-trip and virtualizes from the bottom immediately. Never
 * imported by an island (it reaches `@server/services`); the feed island paginates via the thin
 * `MessagesService`.
 */

/** Everything the chat feed island needs to hydrate the latest page without a client round-trip. */
export interface MessageFeedBootstrap {
	/** The latest page of messages, or `null` when the channel resolved to nothing. */
	page: MessagePage | null;
}

/** Resolve the latest message page for a channel (SSR first paint). */
export function resolveMessageFeed(projectId: string, channelId: string): MessageFeedBootstrap {
	const res = ProjectBackendService.messages({ projectId, channelId });
	return { page: res.ok && res.data ? res.data.page : null };
}
