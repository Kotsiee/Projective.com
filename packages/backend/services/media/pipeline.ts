import type { ImageJob, ImageJobResult } from "./image-jobs.ts";

/**
 * MediaPipeline — runs image jobs in a small pool of Deno Workers, off the request thread.
 *
 * ## Why a Worker, and why it is loaded by URL
 *
 * Decoding a phone photo is most of a second of CPU, and the SSR server renders every other request
 * on the same event loop — inline, one avatar upload would freeze every page load for its duration.
 * A Worker runs it in parallel. The worker module is loaded by URL rather than imported, which keeps
 * it (and its two WASM codec libraries) OUT of the Vite SSR graph and the production bundle: Deno
 * loads it natively from source, the same in `deno task dev`, `deno serve` and `deno test`.
 *
 * {@link workerUrl} therefore resolves the module on disk: beside this file when this file is itself
 * running from source (tests, dev), otherwise from the repository root (the production server runs
 * the built bundle from the repo root, where the source still is). If neither exists the pipeline
 * reports itself unavailable — a named refusal, never a silent inline fallback that would bring the
 * blocking back.
 *
 * ## Pool
 *
 * {@link POOL_SIZE} workers, each handed ONE job at a time (a job's peak memory is a few full-size
 * RGBA copies, so two concurrent jobs per worker would double it for no throughput). Further jobs
 * queue in order. A job that exceeds {@link JOB_TIMEOUT_MS} is failed and its worker replaced — a
 * wedged decoder must not keep its slot. A worker that crashes fails its job and is replaced.
 */

// #region Configuration

/** Concurrent jobs across the server. Two keeps a burst moving without starving the SSR thread. */
export const POOL_SIZE = 2;

/** The longest a single job may run before its worker is replaced. */
export const JOB_TIMEOUT_MS = 90_000;

/** The worker module, relative to the repository root. */
const WORKER_FROM_ROOT = "packages/backend/services/media/image-worker.ts";

// #endregion

// #region Errors

/** A refusal of the INPUT — the message is written for the person who uploaded it. */
export class MediaRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MediaRejectedError";
	}
}

/** The pipeline itself could not run the job (no worker, a crash, a timeout). */
export class MediaUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MediaUnavailableError";
	}
}

// #endregion

// #region Worker resolution

let resolvedUrl: URL | null | undefined;

function fileExists(url: URL): boolean {
	try {
		return Deno.statSync(url).isFile;
	} catch {
		return false;
	}
}

/** Resolve the worker module on disk (see the module note); `null` when it cannot be found. */
export function workerUrl(): URL | null {
	if (resolvedUrl !== undefined) return resolvedUrl;
	const candidates: URL[] = [];
	try {
		const beside = new URL("./image-worker.ts", import.meta.url);
		if (beside.protocol === "file:") candidates.push(beside);
	} catch { /* a non-hierarchical import.meta.url — fall through to the repo root */ }
	try {
		const root = Deno.cwd().replace(/\\/g, "/").replace(/\/+$/, "");
		candidates.push(new URL(`file:///${root.replace(/^\/+/, "")}/${WORKER_FROM_ROOT}`));
	} catch { /* no cwd — nothing more to try */ }
	resolvedUrl = candidates.find(fileExists) ?? null;
	return resolvedUrl;
}

// #endregion

// #region Pool

interface Pending {
	resolve: (result: ImageJobResult) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface Slot {
	worker: Worker;
	busy: boolean;
	current: number | null;
}

interface Queued {
	job: ImageJob;
	resolve: (result: ImageJobResult) => void;
	reject: (error: Error) => void;
}

const slots: Slot[] = [];
const pending = new Map<number, Pending>();
const queue: Queued[] = [];
let nextId = 1;

function spawn(url: URL): Slot {
	const worker = new Worker(url, { type: "module" });
	const slot: Slot = { worker, busy: false, current: null };
	worker.onmessage = (event: MessageEvent) => {
		const reply = event.data as
			| { id: number; ok: true; result: ImageJobResult }
			| { id: number; ok: false; rejection: boolean; message: string };
		const entry = pending.get(reply.id);
		if (!entry) return;
		clearTimeout(entry.timer);
		pending.delete(reply.id);
		slot.busy = false;
		slot.current = null;
		if (reply.ok) entry.resolve(reply.result);
		else entry.reject(reply.rejection ? new MediaRejectedError(reply.message) : new MediaUnavailableError(reply.message));
		pump();
	};
	worker.onerror = (event: ErrorEvent) => {
		event.preventDefault();
		retire(slot, new MediaUnavailableError(`The media worker crashed: ${event.message}`));
	};
	return slot;
}

/** Fail a slot's in-flight job, terminate it, and let the queue respawn a replacement. */
function retire(slot: Slot, error: Error): void {
	const id = slot.current;
	if (id !== null) {
		const entry = pending.get(id);
		if (entry) {
			clearTimeout(entry.timer);
			pending.delete(id);
			entry.reject(error);
		}
	}
	try {
		slot.worker.terminate();
	} catch { /* already gone */ }
	const at = slots.indexOf(slot);
	if (at >= 0) slots.splice(at, 1);
	pump();
}

function pump(): void {
	while (queue.length > 0) {
		let slot = slots.find((s) => !s.busy);
		if (!slot && slots.length < POOL_SIZE) {
			const url = workerUrl();
			if (!url) {
				for (const q of queue.splice(0)) {
					q.reject(new MediaUnavailableError("Media processing isn't available on this server."));
				}
				return;
			}
			slot = spawn(url);
			slots.push(slot);
		}
		if (!slot) return;
		const next = queue.shift()!;
		const id = nextId++;
		slot.busy = true;
		slot.current = id;
		const owner = slot;
		const timer = setTimeout(() => {
			retire(owner, new MediaUnavailableError("Processing this file took too long."));
		}, JOB_TIMEOUT_MS);
		pending.set(id, { resolve: next.resolve, reject: next.reject, timer });
		// Copy into a fresh buffer the worker can take ownership of; the caller keeps its own bytes.
		const bytes = next.job.bytes.slice();
		owner.worker.postMessage({ id, job: { ...next.job, bytes } }, { transfer: [bytes.buffer] });
	}
}

// #endregion

// #region Public API

export const MediaPipeline = {
	/**
	 * Run one image job. Resolves with the encoded outputs; rejects with {@link MediaRejectedError}
	 * when the INPUT is refused (not a readable picture, too large) and {@link MediaUnavailableError}
	 * when the pipeline could not run it.
	 */
	run(job: ImageJob): Promise<ImageJobResult> {
		return new Promise((resolve, reject) => {
			queue.push({ job, resolve, reject });
			pump();
		});
	},

	/** Terminate every worker — for tests and a clean shutdown. Pending jobs are failed. */
	shutdown(): void {
		// The queue first: retiring a slot pumps the queue, which would otherwise spawn a replacement.
		for (const q of queue.splice(0)) q.reject(new MediaUnavailableError("The media pipeline shut down."));
		for (const slot of [...slots]) retire(slot, new MediaUnavailableError("The media pipeline shut down."));
	},
};

// #endregion
