import type { WorkspaceDetail, WorkspaceKind } from "@projective/types/workspace";
import type { ReadActor } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";
import { once as onceForRequest } from "@web/utils/request-memo.ts";

/**
 * workspace-memo — the request memo every `/teams` and `/businesses` server read shares, and the
 * console detail read itself, apart from `workspace-ssr` so a module that must load without the
 * registry's glyphs (the team catalogue's seller scope, Decision #312) reads the same memoised detail
 * the console's route and bands do. Server-only.
 */

// #region Request-scoped memo
/**
 * Run `run` at most once per request, actor and `key` — the shared request memo with the reader
 * folded into the key, so no `/teams` or `/businesses` read can leave it out.
 */
export function once<T>(
	url: URL,
	actor: ReadActor,
	key: string,
	run: () => Promise<T>,
): Promise<T> {
	return onceForRequest(url, `workspace|${key}|${actor.userId}|${actor.contextId}`, run);
}
// #endregion

// #region Console detail
/**
 * Resolve one entity's console projection by its handle (or row id), or `null` when it does not exist,
 * the viewer is not a member, or it could not be read.
 *
 * **`null` deliberately does NOT degrade to an empty detail.** A fabricated console would show a real
 * name, an empty roster and a zeroed wallet — which reads as "your team lost its members and its money",
 * the single worst lie this surface could tell. Memoized per request.
 */
export function resolveWorkspaceDetail(
	kind: WorkspaceKind,
	ref: string,
	actor: ReadActor,
	url: URL,
): Promise<WorkspaceDetail | null> {
	if (!ref) return Promise.resolve(null);
	return once(url, actor, `detail:${kind}:${ref.toLowerCase()}`, async () => {
		const res = await WorkspaceBackendService.detail(kind, ref, actor);
		return res.ok && res.data ? res.data : null;
	});
}
// #endregion
