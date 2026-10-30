import { fail, type ServiceResult } from "../ServiceResult.ts";
import {
	type RateLimitBucket,
	type RateLimitRule,
	SlidingWindowLimiter,
	takeAll,
} from "../../core/rate-limit.ts";

/**
 * auth-throttle — the app-level rate limit on every `POST /api/auth/*` (IW-H3).
 *
 * GoTrue's own per-IP limits are not enough on their own: they see the app server's address unless
 * the client's is forwarded, and they hold no per-account brute-force throttle. So every auth action
 * is counted here twice, per client address and per identifier, before it reaches GoTrue:
 *
 * - **Credential guesses** (`login`, `verify`, `reset`) count every attempt per client address, but
 *   only FAILED attempts per identifier. A person signing in correctly is never slowed by their own
 *   history, while a password or code sweep on one account stops after a handful of misses from
 *   anywhere.
 * - **Mail senders** (`join`, `resend`, `forgot`) count every attempt per identifier, so one
 *   address cannot be mail-bombed from many clients.
 * - **Session upkeep** (`refresh`, `logout`, `sso`) counts per client address only, with ceilings no
 *   person reaches by hand.
 *
 * Refusals are uniform: the same 429 and copy whether or not the identifier has an account, so the
 * limiter reveals nothing an attacker could not already see. Per process, like every limiter here
 * (`core/rate-limit.ts`): a first line, not a distributed quota.
 */

// #region Rules
/** Every throttled auth action, one per `POST /api/auth/*` route. */
export type AuthAction =
	| "login"
	| "join"
	| "verify"
	| "resend"
	| "forgot"
	| "reset"
	| "sso"
	| "refresh"
	| "logout";

/** How an action is counted: per client address always, per identifier when it has one. */
export interface AuthThrottleRule {
	readonly client: RateLimitRule;
	readonly identifier?: RateLimitRule & { readonly counts: "every" | "failure" };
}

const MINUTE = 60_000;

/** The ceilings, per action. */
export const AUTH_THROTTLE_RULES: Readonly<Record<AuthAction, AuthThrottleRule>> = {
	login: {
		client: { max: 30, windowMs: 5 * MINUTE },
		identifier: { max: 10, windowMs: 15 * MINUTE, counts: "failure" },
	},
	verify: {
		client: { max: 30, windowMs: 10 * MINUTE },
		identifier: { max: 10, windowMs: 15 * MINUTE, counts: "failure" },
	},
	reset: {
		client: { max: 30, windowMs: 10 * MINUTE },
		identifier: { max: 10, windowMs: 15 * MINUTE, counts: "failure" },
	},
	join: {
		client: { max: 20, windowMs: 60 * MINUTE },
		identifier: { max: 5, windowMs: 60 * MINUTE, counts: "every" },
	},
	resend: {
		client: { max: 10, windowMs: 10 * MINUTE },
		identifier: { max: 5, windowMs: 10 * MINUTE, counts: "every" },
	},
	forgot: {
		client: { max: 10, windowMs: 15 * MINUTE },
		identifier: { max: 5, windowMs: 15 * MINUTE, counts: "every" },
	},
	sso: { client: { max: 30, windowMs: 5 * MINUTE } },
	refresh: { client: { max: 120, windowMs: 5 * MINUTE } },
	logout: { client: { max: 60, windowMs: 5 * MINUTE } },
};

/** The copy every throttled auth request receives. */
export const AUTH_THROTTLED_MESSAGE =
	"Too many attempts just now. Please wait a few minutes and try again.";
// #endregion

// #region Throttle
/** Who an auth request is counted as. */
export interface AuthThrottleSubject {
	/** The caller's transport address (`utils/client-key.ts`). */
	clientKey: string;
	/** The email, username or address the request names, when it names one. */
	identifier?: string;
}

/** Whether a service outcome counts as a failed credential guess (a wrong password or code). */
function isGuessFailure(result: ServiceResult<unknown>): boolean {
	return !result.ok && (result.status === 401 || result.status === 422);
}

function normalise(identifier: string | undefined): string | null {
	const value = identifier?.trim().toLowerCase();
	return value ? value : null;
}

/**
 * The per-client and per-identifier buckets for every auth action. One process-wide instance
 * ({@link authThrottle}) serves the routes; tests build their own.
 */
export class AuthThrottle {
	readonly #rules: Readonly<Record<AuthAction, AuthThrottleRule>>;
	readonly #client = new Map<AuthAction, SlidingWindowLimiter>();
	readonly #identifier = new Map<AuthAction, SlidingWindowLimiter>();

	constructor(rules: Readonly<Record<AuthAction, AuthThrottleRule>> = AUTH_THROTTLE_RULES) {
		this.#rules = rules;
		for (const [action, rule] of Object.entries(rules) as [AuthAction, AuthThrottleRule][]) {
			this.#client.set(action, new SlidingWindowLimiter(rule.client));
			if (rule.identifier) this.#identifier.set(action, new SlidingWindowLimiter(rule.identifier));
		}
	}

	/**
	 * Admit one attempt, or answer the 429 that refuses it. An admitted attempt is counted against the
	 * client bucket, and against the identifier bucket when that action counts every attempt.
	 */
	admit(
		action: AuthAction,
		subject: AuthThrottleSubject,
		nowMs: number = Date.now(),
	): ServiceResult<never> | null {
		const rule = this.#rules[action];
		const buckets: RateLimitBucket[] = [
			{ limiter: this.#client.get(action)!, key: subject.clientKey },
		];
		const identifier = normalise(subject.identifier);
		const byIdentifier = this.#identifier.get(action);
		if (identifier && byIdentifier && rule.identifier) {
			if (rule.identifier.counts === "every") {
				buckets.push({ limiter: byIdentifier, key: identifier });
			} else {
				const misses = byIdentifier.peek(identifier, nowMs);
				if (!misses.allowed) return throttled(misses.retryAfterMs, nowMs);
			}
		}
		const decision = takeAll(buckets, nowMs);
		return decision.allowed ? null : throttled(decision.retryAfterMs, nowMs);
	}

	/** Count a failed guess against the identifier, for the actions that count failures only. */
	record(
		action: AuthAction,
		subject: AuthThrottleSubject,
		result: ServiceResult<unknown>,
		nowMs: number = Date.now(),
	): void {
		if (this.#rules[action].identifier?.counts !== "failure" || !isGuessFailure(result)) return;
		const identifier = normalise(subject.identifier);
		if (identifier) this.#identifier.get(action)?.take(identifier, nowMs);
	}

	/** Forget every counter. */
	reset(): void {
		for (const limiter of this.#client.values()) limiter.reset();
		for (const limiter of this.#identifier.values()) limiter.reset();
	}
}

/** The 429 a throttled auth request receives; `details.retryAt` says when to try again. */
function throttled(retryAfterMs: number, nowMs: number): ServiceResult<never> {
	return fail(429, {
		message: AUTH_THROTTLED_MESSAGE,
		details: { retryAt: new Date(nowMs + retryAfterMs).toISOString() },
	});
}

/** The process-wide throttle every `/api/auth/*` route counts against. */
export const authThrottle = new AuthThrottle();
// #endregion
