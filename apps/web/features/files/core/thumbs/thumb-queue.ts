/**
 * thumb-queue — who gets to work next. A page of cards can ask for fifty previews at once, and each
 * is a network read and often a decode, so they run a few at a time and the card the person is looking
 * at goes first: newest request first, because a card scrolled into view is what they want now, and
 * one scrolled away has already withdrawn. Heavy lanes also wait for an idle moment between jobs, so
 * a burst of decoding never lands on top of a scroll.
 */

// #region Contract
/**
 * What a job costs. `net` is a small read, `decode` a worker's time, and `gpu` a WebGL context, which
 * a page has few of and which stalls the main thread when it renders.
 */
export type ThumbLane = "net" | "decode" | "gpu";

/** Work to run; it should stop early when `signal` aborts. */
export type ThumbTask<T> = (signal: AbortSignal) => Promise<T>;

/** Runs a job's next step at an idle moment. */
export type IdleWait = () => Promise<void>;

/** Options for {@link createThumbQueue}. */
export interface ThumbQueueOptions {
	concurrency?: Readonly<Record<ThumbLane, number>>;
	idle?: IdleWait;
}

/** A queue. */
export interface ThumbQueue {
	/**
	 * Ask for a job, joining any request for the same key. Resolves with its result, or `null` when
	 * every asker has withdrawn. `withdraw` (through `signal`) cancels it once nobody else wants it.
	 */
	request<T>(
		key: string,
		lane: ThumbLane,
		task: ThumbTask<T>,
		signal: AbortSignal,
	): Promise<T | null>;
	/** Jobs waiting and running, for tests and diagnostics. */
	stats(): { waiting: number; running: number };
}
// #endregion

const DEFAULT_CONCURRENCY: Readonly<Record<ThumbLane, number>> = { net: 4, decode: 2, gpu: 1 };
const IDLE_TIMEOUT_MS = 250;

/** Wait for the browser to have a free moment; a tab that never idles still moves on. */
function browserIdle(): Promise<void> {
	return new Promise((resolve) => {
		const idle = (globalThis as { requestIdleCallback?: typeof requestIdleCallback })
			.requestIdleCallback;
		if (idle) idle(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
		else setTimeout(resolve, 0);
	});
}

interface Job {
	key: string;
	lane: ThumbLane;
	task: ThumbTask<unknown>;
	askers: Set<(value: unknown) => void>;
	controller: AbortController;
	running: boolean;
}

/** Create a queue. One per page: the point of it is that every card shares the limits. */
export function createThumbQueue(options: ThumbQueueOptions = {}): ThumbQueue {
	const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
	const idle = options.idle ?? browserIdle;
	const jobs = new Map<string, Job>();
	const active: Record<ThumbLane, number> = { net: 0, decode: 0, gpu: 0 };

	const finish = (job: Job, value: unknown) => {
		jobs.delete(job.key);
		for (const settle of job.askers) settle(value);
		job.askers.clear();
	};

	const start = (job: Job) => {
		job.running = true;
		active[job.lane] += 1;
		(async () => {
			if (job.lane !== "net") await idle();
			if (job.controller.signal.aborted) return null;
			return await job.task(job.controller.signal);
		})().catch(() => null).then((value) => {
			active[job.lane] -= 1;
			finish(job, value);
			pump();
		});
	};

	function pump(): void {
		for (const lane of ["net", "decode", "gpu"] as const) {
			while (active[lane] < concurrency[lane]) {
				// Map order is request order, so the last match is the newest request.
				const next = [...jobs.values()].findLast((job) => job.lane === lane && !job.running);
				if (!next) break;
				start(next);
			}
		}
	}

	return {
		request<T>(key: string, lane: ThumbLane, task: ThumbTask<T>, signal: AbortSignal) {
			if (signal.aborted) return Promise.resolve(null);
			return new Promise<T | null>((resolve) => {
				const settle = resolve as (value: unknown) => void;
				let job = jobs.get(key);
				if (job) {
					// A repeat ask is the person coming back to this card: move it to the front.
					jobs.delete(key);
					jobs.set(key, job);
				} else {
					job = {
						key,
						lane,
						task,
						askers: new Set(),
						controller: new AbortController(),
						running: false,
					};
					jobs.set(key, job);
				}
				job.askers.add(settle);
				const current = job;
				signal.addEventListener("abort", () => {
					current.askers.delete(settle);
					resolve(null);
					if (current.askers.size > 0) return;
					if (current.running) current.controller.abort();
					else jobs.delete(key);
				}, { once: true });
				queueMicrotask(pump);
			});
		},
		stats() {
			const running = active.net + active.decode + active.gpu;
			return { waiting: jobs.size - running, running };
		},
	};
}
