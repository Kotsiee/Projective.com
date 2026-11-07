/// <reference lib="dom" />
import { markThumbEmpty, readThumb, saveThumb, type ThumbResult } from "./thumb-cache.ts";
import type { ThumbJob } from "./thumb-plan.ts";
import { createThumbQueue } from "./thumb-queue.ts";
import { renderThumb } from "./thumb-render.ts";

/**
 * thumb-store — a card's one call: the thumbnail for this job, from the cache if it has been drawn
 * before and through the shared queue if not.
 */

const queue = createThumbQueue();

/** The thumbnail for a job; `null` when the card that asked has gone away. */
export async function loadThumb(job: ThumbJob, signal: AbortSignal): Promise<ThumbResult | null> {
	const known = await readThumb(job.key);
	if (known) return known;
	const output = await queue.request(job.key, job.lane, (s) => renderThumb(job, s), signal);
	if (signal.aborted) return null;
	return output ? saveThumb(job.key, output) : markThumbEmpty(job.key);
}
