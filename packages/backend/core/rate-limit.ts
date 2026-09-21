/**
 * rate-limit — an in-process SLIDING-WINDOW limiter keyed by acting identity.
 *
 * One instance per limited action, declared beside the service that owns it, each with its own rule
 * (`max` events inside `windowMs`). Sliding rather than fixed-bucket, because a fixed bucket lets a
 * caller spend a whole window's allowance in its last second and the next window's in its first —
 * twice the ceiling in two seconds, which is exactly the burst a limit exists to stop.
 *
 * **Per process, deliberately.** A limiter here bounds one server's view of one caller. It is a
 * first line against a stuck double-press or a scripted burst, not a distributed quota: two
 * instances of the app hold two counters, and a caller who moves between them gets two allowances.
 * The durable ceiling belongs to the database (or a shared store) once the write it guards persists
 * there; until then the counter and the write share one lifetime, which is the honest scope.
 *
 * Memory is bounded by construction: a key's timestamps are pruned on every touch, an empty key is
 * dropped, and a periodic sweep evicts keys nobody has touched inside a window, so a long-running
 * process does not accumulate one entry per identity it ever refused.
 */

// #region Types
/** The ceiling: at most `max` events inside any `windowMs`-wide sliding window. */
export interface RateLimitRule {
	readonly max: number;
	readonly windowMs: number;
}

/** The answer to "may this caller act now" — and, when not, how long they wait. */
export interface RateLimitDecision {
	allowed: boolean;
	/** Events still available inside the current window (0 when refused). */
	remaining: number;
	/** Milliseconds until the OLDEST counted event leaves the window; 0 when allowed. */
	retryAfterMs: number;
}
// #endregion

// #region Limiter
export class SlidingWindowLimiter {
	readonly #rule: RateLimitRule;
	readonly #events = new Map<string, number[]>();
	#sweptAt = 0;

	constructor(rule: RateLimitRule) {
		if (rule.max < 1 || rule.windowMs < 1) {
			throw new RangeError("A rate limit needs a positive ceiling and a positive window.");
		}
		this.#rule = rule;
	}

	/**
	 * Count one event for `key` if the ceiling allows it. An allowed call RECORDS the event; a refused
	 * one records nothing, so a caller hammering a closed door does not push their own reopening
	 * further away.
	 */
	take(key: string, nowMs: number = Date.now()): RateLimitDecision {
		this.#sweep(nowMs);
		const floor = nowMs - this.#rule.windowMs;
		const stamps = (this.#events.get(key) ?? []).filter((t) => t > floor);
		if (stamps.length >= this.#rule.max) {
			this.#events.set(key, stamps);
			return {
				allowed: false,
				remaining: 0,
				retryAfterMs: Math.max(1, stamps[0] + this.#rule.windowMs - nowMs),
			};
		}
		stamps.push(nowMs);
		this.#events.set(key, stamps);
		return { allowed: true, remaining: this.#rule.max - stamps.length, retryAfterMs: 0 };
	}

	/** Read the decision WITHOUT counting — what a form can show before the caller presses. */
	peek(key: string, nowMs: number = Date.now()): RateLimitDecision {
		const floor = nowMs - this.#rule.windowMs;
		const stamps = (this.#events.get(key) ?? []).filter((t) => t > floor);
		if (stamps.length >= this.#rule.max) {
			return {
				allowed: false,
				remaining: 0,
				retryAfterMs: Math.max(1, stamps[0] + this.#rule.windowMs - nowMs),
			};
		}
		return { allowed: true, remaining: this.#rule.max - stamps.length, retryAfterMs: 0 };
	}

	/** Forget every counter — tests, and a process that wants a clean slate. */
	reset(): void {
		this.#events.clear();
		this.#sweptAt = 0;
	}

	/** Drop keys whose every event has left the window; runs at most once per window. */
	#sweep(nowMs: number): void {
		if (nowMs - this.#sweptAt < this.#rule.windowMs) return;
		this.#sweptAt = nowMs;
		const floor = nowMs - this.#rule.windowMs;
		for (const [key, stamps] of this.#events) {
			if (stamps.every((t) => t <= floor)) this.#events.delete(key);
		}
	}
}
// #endregion
