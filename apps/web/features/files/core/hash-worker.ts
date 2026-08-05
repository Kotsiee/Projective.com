import {
	fingerprintFile,
	type HashRequest,
	type HashResponse,
	isHashAborted,
} from "./fingerprint.ts";

/**
 * hash-worker — the Web Worker body that digests upload candidates off the main thread.
 *
 * **This file lives in `core/`, NOT `islands/`, and that is not a filing preference.**
 * `vite.config.ts` `discoverFeatureIslands()` walks `apps/web/features` and registers EVERY `.ts` /
 * `.tsx` / `.jsx` whose path contains an `islands` segment as an island specifier. A worker filed
 * there would be handed to Fresh as a component to revive, which it is not — the build would carry a
 * broken island and the worker would never run as one. Verified against the walker rather than
 * assumed.
 *
 * It computes nothing of its own: it calls the same {@link fingerprintFile} the main-thread path
 * calls, so a digest cannot differ depending on which thread produced it. All this module adds is the
 * message plumbing and per-request cancellation.
 *
 * `self` is typed through a minimal structural cast rather than `DedicatedWorkerGlobalScope`, which
 * only exists under an explicitly-referenced `deno.worker` lib — the cast keeps a plain `deno check`
 * of the whole app working without changing the lib for every other module.
 */

// #region Worker scope
interface WorkerScope {
	addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
	postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
// #endregion

// #region Cancellation
/** One controller per in-flight request, so a `cancel` reaches exactly the hash it names. */
const inFlight = new Map<string, AbortController>();
// #endregion

// #region Message loop
scope.addEventListener("message", (event: MessageEvent) => {
	const msg = event.data as HashRequest | undefined;
	if (!msg) return;

	if (msg.kind === "cancel") {
		inFlight.get(msg.id)?.abort();
		return;
	}
	if (msg.kind !== "hash") return;

	const { id, file } = msg;
	const controller = new AbortController();
	inFlight.set(id, controller);

	fingerprintFile(file, {
		signal: controller.signal,
		// Progress is forwarded rather than accumulated: the host owns what a phase's 0–1 means, and a
		// worker that re-scaled it would have to know how many files are in the drop.
		onProgress: (fraction) => {
			scope.postMessage({ kind: "progress", id, fraction } satisfies HashResponse);
		},
	})
		.then((fingerprint) => {
			scope.postMessage({ kind: "done", id, fingerprint } satisfies HashResponse);
		})
		.catch((err: unknown) => {
			scope.postMessage(
				{
					kind: "error",
					id,
					message: err instanceof Error ? err.message : "The file could not be hashed.",
					aborted: isHashAborted(err),
				} satisfies HashResponse,
			);
		})
		.finally(() => {
			inFlight.delete(id);
		});
});
// #endregion
