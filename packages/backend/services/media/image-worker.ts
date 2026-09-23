import { type ImageJob, runImageJob } from "./image-jobs.ts";
import { ImageRejection } from "./image-codec.ts";

/**
 * image-worker — the media pipeline's Worker entry.
 *
 * Loaded by `pipeline.ts` with `new Worker(url, { type: "module" })`, so this module and everything
 * it imports (imagescript, @jsquash/webp) are loaded by Deno NATIVELY — outside the Vite SSR module
 * graph and outside the production bundle. That is deliberate twice over: a CPU-bound decode never
 * blocks the request thread, and two WASM codec libraries never pass through a bundler that would
 * have to relocate their `.wasm` files.
 *
 * Protocol: one request `{ id, job }` in, one reply `{ id, ok, result | message, rejection }` out.
 * The encoded buffers are TRANSFERRED back rather than copied.
 */

interface WorkerScope {
	onmessage: ((event: MessageEvent<{ id: number; job: ImageJob }>) => void) | null;
	postMessage(message: unknown, options?: { transfer?: Transferable[] }): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = async (event) => {
	const { id, job } = event.data;
	try {
		const result = await runImageJob(job);
		const transfer: Transferable[] = [
			...(result.full ? [result.full.bytes.buffer as ArrayBuffer] : []),
			result.tiers.sm.bytes.buffer as ArrayBuffer,
			result.tiers.md.bytes.buffer as ArrayBuffer,
			result.tiers.lg.bytes.buffer as ArrayBuffer,
		];
		scope.postMessage({ id, ok: true, result }, { transfer });
	} catch (err) {
		scope.postMessage({
			id,
			ok: false,
			rejection: err instanceof ImageRejection,
			message: err instanceof Error ? err.message : String(err),
		});
	}
};
