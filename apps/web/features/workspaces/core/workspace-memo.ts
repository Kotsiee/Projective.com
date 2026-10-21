import type { WorkspaceDetail, WorkspaceKind } from "@projective/types/workspace";
import type { ReadActor } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * workspace-memo — the request memo every `/teams` and `/businesses` server read shares, and the
 * console detail read itself, apart from `workspace-ssr` so a module that must load without the
 * registry's glyphs (the team catalogue's seller scope, Decision #312) reads the same memoised detail
 * the console's route and bands do. Server-only.
 */

// #region Request-scoped memo
/**
 * One read per question per request, however many regions ask.
 *
 * A console page is resolved by its route handler AND by the lane, header and footer slots; without this
 * the detail would be read from Postgres four times for one page (the roster three times on the index).
 * Keyed on the `URL` OBJECT, the wallet precedent: Fresh hands the handler and every slot resolver of one
 * request the same instance and the next request a new one, so an entry can never outlive the request
 * that made it — which matters, because the read after a mutation must see the mutation. The stored
 * value is the PROMISE, so the three bands, resolved concurrently, share one read in flight.
 */
const READS = new WeakMap<URL, Map<string, Promise<unknown>>>();

/** Run `run` at most once per request, actor and `key`; later callers share its promise. */
export function once<T>(
	url: URL,
	actor: ReadActor,
	key: string,
	run: () => Promise<T>,
): Promise<T> {
	let reads = READS.get(url);
	if (!reads) {
		reads = new Map();
		READS.set(url, reads);
	}
	const slot = `${key}|${actor.userId}|${actor.contextId}`;
	const hit = reads.get(slot) as Promise<T> | undefined;
	if (hit) return hit;
	const promise = run();
	reads.set(slot, promise);
	return promise;
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
