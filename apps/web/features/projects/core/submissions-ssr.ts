import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { SubmissionListPage } from "../types/projects-types.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * submissions-ssr — the server-only bootstrap for the Submissions explorer's first paint. Calls the fat
 * {@link ProjectBackendService.submissions} directly (no HTTP hop) so the explorer ships its first page
 * of files + the navigation tree + the breadcrumb trail in the initial byte; the island then refines /
 * navigates via the thin {@link SubmissionsService}. The `path` is the catch-all route's trailing
 * segments, so a deep-linked tree node (or a hard refresh on one) resolves to the right initial scope.
 * Mirrors {@link resolveFilePage}. Never imported by an island.
 */
export interface SubmissionBootstrap {
	page: SubmissionListPage | null;
}

/**
 * Resolve the initial submissions page. `channelId` unset → project scope (Stages as tree roots);
 * `path` selects the initial tree node (segment chain), `[]`/undefined = the scope root.
 */
export async function resolveSubmissionPage(
	projectId: string,
	actor: ReadActor,
	channelId?: string | null,
	path?: string[],
): Promise<SubmissionBootstrap> {
	const res = await ProjectBackendService.submissions({
		projectId,
		channelId: channelId ?? null,
		path: path && path.length > 0 ? path : undefined,
	}, actor);
	return { page: res.ok && res.data ? res.data.page : null };
}

const READS = new WeakMap<URL, Map<string, Promise<SubmissionBootstrap>>>();

/**
 * {@link resolveSubmissionPage}, read once per request: the route and the header band slot both ask
 * (Decision #317 — the band titles the node the body shows), keyed on the request's own URL object as
 * the workspace console's memo is.
 */
export function resolveSubmissionPageOnce(
	url: URL,
	projectId: string,
	actor: ReadActor,
	channelId?: string | null,
	path?: string[],
): Promise<SubmissionBootstrap> {
	let reads = READS.get(url);
	if (!reads) {
		reads = new Map();
		READS.set(url, reads);
	}
	const key = `${projectId}|${channelId ?? ""}|${
		(path ?? []).join("/")
	}|${actor.userId}|${actor.contextId}`;
	const hit = reads.get(key);
	if (hit) return hit;
	const read = resolveSubmissionPage(projectId, actor, channelId, path);
	reads.set(key, read);
	return read;
}
