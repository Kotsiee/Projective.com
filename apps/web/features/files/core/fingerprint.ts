import { type ContentFingerprint, SAMPLE_WINDOW_BYTES, shouldSample } from "../types/file-types.ts";

/**
 * fingerprint — content-addressed digests for the upload pre-flight, computed in the browser before
 * any bytes travel.
 *
 * **`crypto.subtle` has no streaming API.** `digest()` takes a whole buffer and returns a promise;
 * there is no `update()` / `final()` pair, so a file genuinely cannot be digested incrementally. Two
 * consequences follow, and both are load-bearing:
 *
 *  1. The "chunked" full digest below reads the file in slices for PROGRESS and backpressure, then
 *     digests the assembled buffer in one call. The chunking is why a 200 MB file can report 43%
 *     instead of sitting at 0%; it is not a streaming hash, and claiming otherwise would be a lie
 *     about where the time goes.
 *  2. Above {@link SAMPLE_THRESHOLD_BYTES} a full digest means holding the entire file in memory and
 *     blocking on one enormous `digest()`. That is why the SAMPLED path exists at all — head window,
 *     tail window and exact length — and why {@link ContentFingerprint} carries `sampled`.
 *
 * **A sampled digest is a HINT the server must confirm.** Two files sharing a head, a tail and a
 * length are very probably the same file and are absolutely not certainly the same file. The client
 * may prompt on a sampled match; the server must re-digest in full before it collapses two rows onto
 * one stored object, because a false positive there does not save a copy — it silently replaces one
 * person's file with someone else's.
 *
 * **`crypto.subtle` also requires a SECURE CONTEXT** (https, or localhost). It is `undefined`
 * otherwise — not throwing, just absent. When it is absent this module returns `null` and the caller
 * DEGRADES to name+size matching ({@link degradedKey}); it must never fail the upload. Losing the
 * duplicate prompt is a worse experience; refusing the upload is a broken product.
 */

// #region Availability + degraded fallback
/**
 * Whether this browser can compute a digest at all.
 *
 * Tests for `crypto.subtle` directly rather than for `isSecureContext`, because the absence of the
 * API is the fact that matters and a UA could in principle expose one without the other.
 */
export function hasSubtleCrypto(): boolean {
	return typeof globalThis.crypto !== "undefined" &&
		typeof globalThis.crypto.subtle !== "undefined";
}

/**
 * The fallback identity for a file we could not digest: its name and its exact byte length.
 *
 * Weaker than a sampled digest by a wide margin, and deliberately NOT dressed up as a hash — it is
 * never assigned to `ContentFingerprint.hash`, which is regex-constrained to 64 hex characters, so it
 * cannot be mistaken for one downstream. It is only ever a client-side "have you got one of these
 * already?" lookup key.
 */
export function degradedKey(name: string, sizeBytes: number): string {
	return `${name}\u0000${sizeBytes}`;
}
// #endregion

// #region Abort
/** Thrown when a hash is cancelled. Distinct from a failure — a cancelled task is not a broken one. */
export class HashAbortedError extends Error {
	constructor() {
		super("Hashing was cancelled.");
		this.name = "HashAbortedError";
	}
}

/** Whether a caught value is the cancellation above (so the queue marks `cancelled`, not `error`). */
export function isHashAborted(err: unknown): boolean {
	return err instanceof HashAbortedError ||
		(typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError");
}
// #endregion

// #region Digest primitives
/** How much is read per slice — large enough to be few round trips, small enough to report progress. */
const READ_CHUNK_BYTES = 8 * 1024 * 1024;

/** Render a digest as the lowercase 64-character hex the SSOT's `ContentFingerprintSchema` demands. */
function toHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let out = "";
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
	return out;
}

/** The 8-byte little-endian encoding of a length — a FIXED-width size field, so the sample is unambiguous. */
function encodeSize(sizeBytes: number): Uint8Array {
	const buf = new ArrayBuffer(8);
	new DataView(buf).setBigUint64(0, BigInt(Math.max(0, Math.trunc(sizeBytes))), true);
	return new Uint8Array(buf);
}

/** Options shared by every digest path. */
export interface FingerprintOptions {
	/** Cancels the read between slices; the promise rejects with {@link HashAbortedError}. */
	signal?: AbortSignal | null;
	/** Progress within THIS digest, 0–1. Called after each slice. */
	onProgress?: (fraction: number) => void;
}

/** Throw if the caller has cancelled. Checked between slices, which is the only interruptible moment. */
function checkAborted(signal?: AbortSignal | null): void {
	if (signal?.aborted) throw new HashAbortedError();
}

/**
 * Digest every byte, reading in slices so the caller can show progress.
 *
 * The assembled buffer is one allocation the size of the file — unavoidable, since `digest()` takes a
 * whole buffer (see the module note). This path is only ever taken below the sampling threshold, which
 * is exactly the bound that keeps that allocation reasonable.
 */
async function digestFull(blob: Blob, opts?: FingerprintOptions): Promise<string> {
	const size = blob.size;
	const buffer = new Uint8Array(size);
	let offset = 0;
	while (offset < size) {
		checkAborted(opts?.signal);
		const end = Math.min(offset + READ_CHUNK_BYTES, size);
		const part = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
		// A zero-length read would spin forever; a truncated/unreadable Blob is a failure, not a loop.
		if (part.byteLength === 0) throw new Error("The file could not be read to the end.");
		buffer.set(part, offset);
		offset += part.byteLength;
		opts?.onProgress?.(size === 0 ? 1 : offset / size);
	}
	checkAborted(opts?.signal);
	return toHex(await globalThis.crypto.subtle.digest("SHA-256", buffer));
}

/**
 * Digest a SAMPLE: the head window, the tail window and the exact length, in that order.
 *
 * The length is included because it is part of what the claim actually covers — two files with the
 * same head and tail but different lengths are different files, and the length is what proves it. It
 * is encoded at a fixed 8 bytes so the concatenation can never be parsed two ways.
 */
async function digestSampled(blob: Blob, opts?: FingerprintOptions): Promise<string> {
	const size = blob.size;
	checkAborted(opts?.signal);
	const head = new Uint8Array(
		await blob.slice(0, Math.min(SAMPLE_WINDOW_BYTES, size)).arrayBuffer(),
	);
	opts?.onProgress?.(0.5);
	checkAborted(opts?.signal);
	const tail = new Uint8Array(
		await blob.slice(Math.max(0, size - SAMPLE_WINDOW_BYTES), size).arrayBuffer(),
	);
	const tag = encodeSize(size);

	const combined = new Uint8Array(head.byteLength + tail.byteLength + tag.byteLength);
	combined.set(head, 0);
	combined.set(tail, head.byteLength);
	combined.set(tag, head.byteLength + tail.byteLength);

	opts?.onProgress?.(1);
	checkAborted(opts?.signal);
	return toHex(await globalThis.crypto.subtle.digest("SHA-256", combined));
}
// #endregion

// #region Main-thread wrapper
/**
 * Fingerprint one file, choosing the full or the sampled path by size.
 *
 * Returns `null` — never throws — when this browser has no `crypto.subtle`, so a caller in an
 * insecure context degrades to {@link degradedKey} instead of failing the upload. A cancelled hash
 * DOES reject, with {@link HashAbortedError}, because "the person stopped it" and "this browser
 * cannot" are different outcomes that deserve different rows in the queue.
 *
 * This runs on the calling thread. For a large drop, prefer {@link createFingerprinter}, which moves
 * the same work into `hash-worker.ts` and keeps the grid interactive while it runs.
 */
export async function fingerprintFile(
	file: Blob,
	opts?: FingerprintOptions,
): Promise<ContentFingerprint | null> {
	if (!hasSubtleCrypto()) return null;
	const sizeBytes = file.size;
	const sampled = shouldSample(sizeBytes);
	const hash = sampled ? await digestSampled(file, opts) : await digestFull(file, opts);
	return {
		algo: sampled ? "sampled-sha-256" : "sha-256",
		hash,
		sizeBytes,
		sampled,
	};
}
// #endregion

// #region Worker protocol
/** A request posted INTO `hash-worker.ts`. */
export type HashRequest =
	| { kind: "hash"; id: string; file: Blob }
	| { kind: "cancel"; id: string };

/** A message posted back OUT of `hash-worker.ts`. */
export type HashResponse =
	| { kind: "progress"; id: string; fraction: number }
	| { kind: "done"; id: string; fingerprint: ContentFingerprint | null }
	| { kind: "error"; id: string; message: string; aborted: boolean };

/** The worker module URL. Kept here so the `new URL` specifier Vite rewrites lives in exactly one place. */
export function hashWorkerUrl(): URL {
	return new URL("./hash-worker.ts", import.meta.url);
}
// #endregion

// #region Offloaded fingerprinter
/** A disposable fingerprinting session. */
export interface Fingerprinter {
	/** Fingerprint one file. Resolves `null` when the browser cannot digest (see the module note). */
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
 * A worker that fails to start is not an error: the fallback produces identical digests from the same
 * shared functions, just on the main thread, so the only thing lost is responsiveness.
 */
export function createFingerprinter(): Fingerprinter {
	let worker: Worker | null = null;
	let started = false;
	let seq = 0;

	function ensureWorker(): Worker | null {
		if (started) return worker;
		started = true;
		if (typeof Worker === "undefined") return null;
		try {
			worker = new Worker(hashWorkerUrl(), { type: "module" });
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
					w.removeEventListener("message", onMessage);
					opts?.signal?.removeEventListener("abort", onAbort);
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
				w.addEventListener("message", onMessage);
				opts?.signal?.addEventListener("abort", onAbort, { once: true });
				w.postMessage({ kind: "hash", id, file } satisfies HashRequest);
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
