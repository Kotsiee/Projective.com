import { batch, type ReadonlySignal, signal } from "@preact/signals";
import type { ExploreCategory, Suggestions, SuggestQuery } from "../types/explore-types.ts";
import type { ExploreResult } from "../types/results.ts";

/**
 * The typeahead's request state, as a plain object over signals so it can be driven by a fake clock
 * in a test; `useSearchSuggest` is the component binding.
 *
 * Three guards keep a slow answer from overwriting a newer one: keystrokes are debounced, a new
 * request ABORTS the one in flight, and every request carries a sequence number that must still be
 * the latest when its answer lands — a fetcher that ignores its signal is still dropped.
 */

// #region Types
/** The transport the controller calls; `ExploreService.suggest` in the app, a stub in tests. */
export type SuggestFetcher = (
	query: SuggestQuery,
	signal: AbortSignal,
) => Promise<ExploreResult<Suggestions>>;

/** `idle` nothing typed · `loading` waiting or in flight · `ready` answered · `error` failed. */
export type SuggestStatus = "idle" | "loading" | "ready" | "error";

export interface SuggestControllerOptions {
	fetcher: SuggestFetcher;
	scope?: ExploreCategory;
	/** Quiet period after the last keystroke before a request goes out, ms. */
	delayMs?: number;
}

export interface SuggestController {
	/** The raw text as typed. */
	query: ReadonlySignal<string>;
	scope: ReadonlySignal<ExploreCategory>;
	/** State of the matches for the current non-empty query. */
	status: ReadonlySignal<SuggestStatus>;
	/** The latest answer for the current query; kept while a newer one loads, cleared on empty. */
	data: ReadonlySignal<Suggestions | null>;
	error: ReadonlySignal<string | null>;
	/** Trending terms for the current scope, or `null` until loaded. */
	trending: ReadonlySignal<string[] | null>;
	trendingStatus: ReadonlySignal<SuggestStatus>;
	/** Set the text; the request is debounced and an empty value cancels everything. */
	setQuery: (raw: string) => void;
	/** Switch scope; a non-empty query re-runs at once, since a pick is not a keystroke. */
	setScope: (scope: ExploreCategory) => void;
	/** Load trending for the current scope unless cached. */
	prime: () => void;
	/** Re-run the current query (or trending) after a failure. */
	retry: () => void;
	/** Cancel timers and requests; the controller is inert afterwards. */
	dispose: () => void;
}
// #endregion

/** Default quiet period between the last keystroke and the request. */
export const SUGGEST_DEBOUNCE_MS = 200;

const FAILED = "Suggestions are unavailable right now.";

/** Build a typeahead controller over `fetcher`. */
export function createSuggestController(options: SuggestControllerOptions): SuggestController {
	const delay = options.delayMs ?? SUGGEST_DEBOUNCE_MS;
	const query = signal("");
	const scope = signal<ExploreCategory>(options.scope ?? "all");
	const status = signal<SuggestStatus>("idle");
	const data = signal<Suggestions | null>(null);
	const error = signal<string | null>(null);
	const trending = signal<string[] | null>(null);
	const trendingStatus = signal<SuggestStatus>("idle");

	const trendingCache = new Map<ExploreCategory, string[]>();
	let seq = 0;
	let trendSeq = 0;
	let inflight: AbortController | null = null;
	let trendInflight: AbortController | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	async function request(q: string, ac: AbortController): Promise<ExploreResult<Suggestions>> {
		try {
			return await options.fetcher({ q, scope: scope.peek() }, ac.signal);
		} catch {
			return { ok: false, message: FAILED };
		}
	}

	function cancel(): void {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		inflight?.abort();
		inflight = null;
		seq++;
	}

	async function run(q: string): Promise<void> {
		const id = ++seq;
		const ac = new AbortController();
		inflight = ac;
		const res = await request(q, ac);
		if (disposed || id !== seq || ac.signal.aborted) return;
		inflight = null;
		batch(() => {
			if (res.ok && res.data) {
				data.value = res.data;
				error.value = null;
				status.value = "ready";
			} else {
				error.value = res.message ?? FAILED;
				status.value = "error";
			}
		});
	}

	function schedule(q: string, wait: number): void {
		cancel();
		batch(() => {
			status.value = "loading";
			error.value = null;
		});
		if (wait <= 0) {
			void run(q);
			return;
		}
		timer = setTimeout(() => {
			timer = undefined;
			void run(q);
		}, wait);
	}

	async function loadTrending(): Promise<void> {
		const forScope = scope.peek();
		const id = ++trendSeq;
		trendInflight?.abort();
		const ac = new AbortController();
		trendInflight = ac;
		trendingStatus.value = "loading";
		const res = await request("", ac);
		if (disposed || id !== trendSeq || ac.signal.aborted) return;
		trendInflight = null;
		batch(() => {
			if (res.ok && res.data) {
				trendingCache.set(forScope, res.data.trending);
				trending.value = res.data.trending;
				trendingStatus.value = "ready";
			} else {
				trendingStatus.value = "error";
			}
		});
	}

	function prime(): void {
		if (disposed) return;
		const cached = trendingCache.get(scope.peek());
		if (cached) {
			batch(() => {
				trending.value = cached;
				trendingStatus.value = "ready";
			});
			return;
		}
		if (trendingStatus.peek() !== "loading") void loadTrending();
	}

	function setQuery(raw: string): void {
		if (disposed) return;
		query.value = raw;
		const q = raw.trim();
		if (!q) {
			cancel();
			batch(() => {
				status.value = "idle";
				data.value = null;
				error.value = null;
			});
			return;
		}
		schedule(q, delay);
	}

	function setScope(next: ExploreCategory): void {
		if (disposed || next === scope.peek()) return;
		trendInflight?.abort();
		trendInflight = null;
		trendSeq++;
		batch(() => {
			scope.value = next;
			trending.value = trendingCache.get(next) ?? null;
			trendingStatus.value = trendingCache.has(next) ? "ready" : "idle";
		});
		const q = query.peek().trim();
		if (q) schedule(q, 0);
	}

	function retry(): void {
		if (disposed) return;
		const q = query.peek().trim();
		if (q) schedule(q, 0);
		else void loadTrending();
	}

	function dispose(): void {
		cancel();
		trendInflight?.abort();
		trendInflight = null;
		disposed = true;
	}

	return {
		query,
		scope,
		status,
		data,
		error,
		trending,
		trendingStatus,
		setQuery,
		setScope,
		prime,
		retry,
		dispose,
	};
}
