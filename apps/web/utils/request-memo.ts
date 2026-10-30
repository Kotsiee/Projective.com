/**
 * request-memo — one read per question per request, however many regions ask (Decision #341, ruling
 * E1 Q10).
 *
 * A page is resolved by its route handler AND by the lane, header, panel and footer slot resolvers,
 * which the layout starts together; without a memo each region reads the same rows again. The memo is
 * keyed on the request's own `URL` (or `Request`) OBJECT, not its href: Fresh hands the handler and
 * every slot resolver of one request the same instance and the next request a new one, so an entry
 * can never outlive the request that made it — the read after a mutation must see the mutation — and
 * the `WeakMap` lets it be collected with the request. The stored value is the PROMISE, so resolvers
 * started together share one read in flight.
 *
 * Server-only.
 */

// #region Request-scoped memo
const MEMO = new WeakMap<object, Map<string, Promise<unknown>>>();

/**
 * Run `run` at most once per request `scope` and `key`; later callers share its promise. A rejection
 * leaves the memo, so a retry in the same request runs again.
 *
 * The memo is shared by every module that resolves the request, so a key leads with its module's
 * namespace and carries every input the read depends on — the reader's `userId` and `contextId`
 * included, so two readers resolved against one request can never share an answer.
 */
export function once<T>(scope: object, key: string, run: () => Promise<T>): Promise<T> {
	const memo = MEMO.get(scope) ?? new Map<string, Promise<unknown>>();
	MEMO.set(scope, memo);
	const hit = memo.get(key) as Promise<T> | undefined;
	if (hit) return hit;
	const promise = run();
	memo.set(key, promise);
	promise.catch(() => {
		if (memo.get(key) === promise) memo.delete(key);
	});
	return promise;
}
// #endregion
