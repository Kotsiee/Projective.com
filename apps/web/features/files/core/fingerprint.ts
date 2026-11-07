import { type ContentFingerprint, SAMPLE_WINDOW_BYTES, shouldSample } from "../types/file-types.ts";
import {
	digestFile,
	type FingerprintOptions,
	HashAbortedError,
	hasSubtleCrypto,
} from "./digest.ts";

/**
 * fingerprint — what the upload pre-flight calls. The digests live in `digest.ts`, which a worker can
 * load; this module reads the SSOT's sampling rule, which a worker cannot, and chooses the thread.
 */

export {
	degradedKey,
	type FingerprintOptions,
	HashAbortedError,
	hasSubtleCrypto,
	isHashAborted,
} from "./digest.ts";

// #region Main-thread wrapper
/** The window a file of this size is sampled at, or `null` when every byte is digested. */
function sampleWindowFor(sizeBytes: number): number | null {
	return shouldSample(sizeBytes) ? SAMPLE_WINDOW_BYTES : null;
}

/**
 * Fingerprint one file, choosing the full or the sampled path by size. Resolves `null` when this
 * browser cannot digest, and rejects only on cancellation ({@link digestFile}).
 *
 * This runs on the calling thread. For a large drop, prefer {@link createFingerprinter}, which moves
 * the same work into `hash-worker.ts` and keeps the grid interactive while it runs.
 */
export function fingerprintFile(
	file: Blob,
	opts?: FingerprintOptions,
): Promise<ContentFingerprint | null> {
	return digestFile(file, sampleWindowFor(file.size), opts);
}
// #endregion

// #region Worker protocol
/** A request posted INTO `hash-worker.ts`. */
export type HashRequest =
	| { kind: "hash"; id: string; file: Blob; sampleWindowBytes: number | null }
	| { kind: "cancel"; id: string };

/** A message posted back OUT of `hash-worker.ts`. */
export type HashResponse =
	| { kind: "progress"; id: string; fraction: number }
	| { kind: "done"; id: string; fingerprint: ContentFingerprint | null }
	| { kind: "error"; id: string; message: string; aborted: boolean };
// #endregion

// #region Offloaded fingerprinter
/** A disposable fingerprinting session. */
export interface Fingerprinter {
	/** Fingerprint one file. Resolves `null` when the browser cannot digest (see `digest.ts`). */
	fingerprint(file: Blob, opts?: FingerprintOptions): Promise<ContentFingerprint | null>;
	/** Terminate the worker, if one was started. Safe to call more than once. */
	dispose(): void;
}

/**
 * Create a fingerprinter that offloads to `hash-worker.ts` when the environment allows, and falls
 * back to the calling thread when it does not.
 *
 * **Never constructed at module scope** — a `new Worker` on import would run during SSR (where the
 * constructor does not exist) and would spawn a thread for every page that merely touches this
 * module. Callers create one when a drop starts and {@link Fingerprinter.dispose} it when the queue
 * drains.
 *
 * A worker that fails is not an error: the fallback produces identical digests from the same shared
 * functions, just on the main thread, so the only thing lost is responsiveness. A constructor that
 * throws is the rare case. A script that cannot load returns a normal `Worker` and fires `error`
 * later, so a try/catch alone leaves every job waiting forever.
 */
export function createFingerprinter(): Fingerprinter {
	let worker: Worker | null = null;
	let started = false;
	let seq = 0;
	/** Each job the worker still owes an answer, as the way to finish it on this thread instead. */
	const owed = new Set<() => void>();

	function abandonWorker(): void {
		worker?.terminate();
		worker = null;
		for (const finishHere of [...owed]) finishHere();
	}

	function ensureWorker(): Worker | null {
		if (started) return worker;
		started = true;
		if (typeof Worker === "undefined") return null;
		try {
			// Literal on purpose: Vite bundles a worker only when it can read this exact call. Through a
			// helper, the URL ships as the raw source in a `data:` URL, which the CSP refuses.
			worker = new Worker(new URL("./hash-worker.ts", import.meta.url), { type: "module" });
			worker.addEventListener("error", abandonWorker);
			worker.addEventListener("messageerror", abandonWorker);
		} catch {
			worker = null;
		}
		return worker;
	}

	return {
		fingerprint(file, opts) {
			if (!hasSubtleCrypto()) return Promise.resolve(null);
			const w = ensureWorker();
			if (!w) return fingerprintFile(file, opts);

			const id = `h${++seq}`;
			return new Promise<ContentFingerprint | null>((resolve, reject) => {
				const onAbort = () => {
					w.postMessage({ kind: "cancel", id } satisfies HashRequest);
				};
				const cleanup = () => {
					owed.delete(finishHere);
					w.removeEventListener("message", onMessage);
					opts?.signal?.removeEventListener("abort", onAbort);
				};
				const finishHere = () => {
					cleanup();
					fingerprintFile(file, opts).then(resolve, reject);
				};
				const onMessage = (event: MessageEvent) => {
					const msg = event.data as HashResponse;
					if (!msg || msg.id !== id) return;
					if (msg.kind === "progress") {
						opts?.onProgress?.(msg.fraction);
						return;
					}
					cleanup();
					if (msg.kind === "done") resolve(msg.fingerprint);
					else reject(msg.aborted ? new HashAbortedError() : new Error(msg.message));
				};
				owed.add(finishHere);
				w.addEventListener("message", onMessage);
				opts?.signal?.addEventListener("abort", onAbort, { once: true });
				w.postMessage(
					{
						kind: "hash",
						id,
						file,
						sampleWindowBytes: sampleWindowFor(file.size),
					} satisfies HashRequest,
				);
			});
		},
		dispose() {
			worker?.terminate();
			worker = null;
			started = true;
		},
	};
}
// #endregion
