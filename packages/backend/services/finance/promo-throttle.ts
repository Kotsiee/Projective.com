import { fail, type ServiceResult } from "../ServiceResult.ts";
import { type RateLimitRule, SlidingWindowLimiter, takeAll } from "../../core/rate-limit.ts";

/**
 * promo-throttle — the rate limit on `POST /api/basket/promo` (FINANCE_AUDIT CO22, MARKETPLACE CK2).
 *
 * `finance.resolve_promo_code` tells a guess apart from a real code ("We don't recognise that code"),
 * so an unthrottled route lets a script enumerate every seller's and the platform's codes. Each attempt
 * that names a code counts twice, per signed-in account and per client address (`utils/client-key.ts`,
 * the key the auth routes' throttle uses), so neither switching basket contexts nor switching accounts
 * on one machine resets it. Clearing a code is never counted. Per process, like every limiter here
 * (`core/rate-limit.ts`): a first line, not a distributed quota.
 */

// #region Rules
const MINUTE = 60_000;

/** The ceilings: a buyer trying codes by hand stays far inside them; a scripted burst does not. */
export const PROMO_THROTTLE_RULES: Readonly<{ account: RateLimitRule; client: RateLimitRule }> = {
	account: { max: 10, windowMs: 10 * MINUTE },
	client: { max: 20, windowMs: 10 * MINUTE },
};

/** The copy every throttled promo attempt receives. */
export const PROMO_THROTTLED_MESSAGE =
	"Too many codes tried just now. Please wait a few minutes and try again.";
// #endregion

// #region Throttle
/** Who a promo attempt is counted as. */
export interface PromoThrottleSubject {
	/** The signed-in account's user id. */
	account: string;
	/** The caller's transport address (`utils/client-key.ts`). */
	clientKey: string;
}

/** The per-account and per-client buckets of the promo route; tests build their own. */
export class PromoThrottle {
	readonly #account: SlidingWindowLimiter;
	readonly #client: SlidingWindowLimiter;

	constructor(rules = PROMO_THROTTLE_RULES) {
		this.#account = new SlidingWindowLimiter(rules.account);
		this.#client = new SlidingWindowLimiter(rules.client);
	}

	/**
	 * Admit one attempt, or answer the 429 that refuses it; `details.retryAt` says when to try again.
	 * An admitted attempt counts against both buckets; a refused one against neither.
	 */
	admit(subject: PromoThrottleSubject, nowMs: number = Date.now()): ServiceResult<never> | null {
		const decision = takeAll([
			{ limiter: this.#account, key: subject.account },
			{ limiter: this.#client, key: subject.clientKey },
		], nowMs);
		if (decision.allowed) return null;
		return fail(429, {
			message: PROMO_THROTTLED_MESSAGE,
			details: { retryAt: new Date(nowMs + decision.retryAfterMs).toISOString() },
		});
	}

	/** Forget every counter. */
	reset(): void {
		this.#account.reset();
		this.#client.reset();
	}
}

/** The process-wide throttle `POST /api/basket/promo` counts against. */
export const promoThrottle = new PromoThrottle();

/** Whole seconds until a throttled caller may try again, for `Retry-After`; at least 1. */
export function retryAfterSeconds(
	refused: ServiceResult<never>,
	nowMs: number = Date.now(),
): number {
	const retryAt = Date.parse(String(refused.details?.retryAt ?? ""));
	return Number.isFinite(retryAt) ? Math.max(1, Math.ceil((retryAt - nowMs) / 1000)) : 60;
}
// #endregion
