import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import { readPendingVerification } from "../../core/pending-verification.ts";
import type { AuthPayload } from "./AuthBackendService.ts";

/**
 * verification-status — the decision behind `/verify`'s confirmation poll (Decision #185).
 *
 * The poll answers ONLY for the account named by the signed pending-verification cookie the join (or
 * an unconfirmed sign-in) set in this browser. A caller without a valid cookie — no cookie, a forged
 * or foreign one, an expired one — gets the same body a still-pending account gets, so the endpoint
 * says nothing about whether any address has an account. Every poll is rate-limited: per pending
 * account when the cookie is valid, per client address otherwise.
 */

// #region Contracts
/** One poll, as the thin route parsed it. No email: the cookie is the only subject. */
export interface VerificationPollInput {
	/** The raw pending-verification cookie value, if the request carried one. */
	pendingToken?: string;
	/** A stable key for the caller when no valid cookie names them (the client address). */
	clientKey: string;
	/** Whether this request already carries a session cookie. */
	hasSession: boolean;
	/** Server-sanitised return path. */
	redirectTo: string;
}

/** What the resolver needs from the outside world — injected so it is testable without GoTrue. */
export interface VerificationPollDeps {
	/** The pending-verification HMAC key, or `null` when the server has no root secret. */
	key: CryptoKey | null;
	limiter: SlidingWindowLimiter;
	/** Whether the account's sign-in email is confirmed. Throws only on an infrastructure failure. */
	isConfirmed(userId: string): Promise<boolean>;
	now?: () => number;
}
// #endregion

/** The poll ceiling: a 4s poll is 15 a minute, so two open tabs fit and a scripted sweep does not. */
export const VERIFICATION_POLL_RULE = { max: 30, windowMs: 60_000 } as const;

/** The process-wide poll limiter the live service uses. */
export const verificationPollLimiter = new SlidingWindowLimiter(VERIFICATION_POLL_RULE);

/**
 * Resolve one poll. Pending and unbound callers receive the identical `{ verified: false }` body;
 * a confirmed account additionally reports whether this request already holds a session, so the page
 * either continues in or asks the reader to sign in.
 */
export async function resolveVerificationStatus(
	input: VerificationPollInput,
	deps: VerificationPollDeps,
): Promise<ServiceResult<AuthPayload>> {
	const now = deps.now?.() ?? Date.now();
	const userId = deps.key ? await readPendingVerification(input.pendingToken, deps.key, now) : null;

	const decision = deps.limiter.take(
		userId ? `pending:${userId}` : `client:${input.clientKey}`,
		now,
	);
	if (!decision.allowed) {
		return fail(429, {
			message: "Too many checks just now. Try again shortly.",
			details: { retryAt: new Date(now + decision.retryAfterMs).toISOString() },
		});
	}

	const pending = ok<AuthPayload>({ verified: false, redirectTo: input.redirectTo });
	if (!userId) return pending;

	try {
		if (!(await deps.isConfirmed(userId))) return pending;
	} catch (e) {
		return fail(503, {
			message: e instanceof Error ? e.message : "We couldn't check your confirmation just now.",
		});
	}
	return ok({ verified: true, signedIn: input.hasSession, redirectTo: input.redirectTo });
}
