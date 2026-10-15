/**
 * kv.ts — the one shared Deno KV handle for the fat layer's cross-isolate caches.
 *
 * KV is an optimisation everywhere it is used, never a dependency: `Deno.openKv` is unstable-gated
 * (`--unstable-kv`, which `deno task serve` passes), may be refused by permissions, or may fail to
 * open. Every one of those is reported as `null`, and each caller degrades to its per-isolate memory
 * cache. The open is attempted once per isolate and memoised — success or failure — so a missing KV
 * never costs a syscall per request.
 */

// #region Shared handle
/** The memoised open. `undefined` = not attempted yet; it then settles to a handle or `null`. */
let shared: Promise<Deno.Kv | null> | undefined;

/** Open Deno KV, tolerating every reason it might not exist. Resolves to `null`, never rejects. */
async function open(): Promise<Deno.Kv | null> {
	try {
		// `Deno.openKv` is unstable-gated; on a runtime without it the property is simply absent.
		const openKv = (Deno as { openKv?: () => Promise<Deno.Kv> }).openKv;
		return typeof openKv === "function" ? await openKv.call(Deno) : null;
	} catch {
		return null;
	}
}

/**
 * The isolate's shared Deno KV handle, or `null` when KV is unavailable here. Opened lazily on the
 * first call and memoised, so every caller shares one handle and one failed attempt. Never throws.
 */
export function openSharedKv(): Promise<Deno.Kv | null> {
	shared ??= open();
	return shared;
}
// #endregion
