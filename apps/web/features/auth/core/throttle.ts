import type { ServiceResult } from "@server/services/ServiceResult.ts";
import {
	type AuthAction,
	authThrottle,
	type AuthThrottleSubject,
} from "@server/services/auth/auth-throttle.ts";
import { clientKey } from "@web/utils/client-key.ts";
import { toAuthResponse } from "./respond.ts";

/**
 * throttle — the `/api/auth/*` routes' side of the auth rate limit (IW-H3). A route names its action
 * and identifier, asks {@link refuseIfThrottled} before calling the service, and hands the outcome to
 * {@link noteAuthOutcome} so a failed guess counts against the account it named.
 */

/** The request's throttle subject: its client address and the identifier it names, if any. */
export function authSubject(
	req: Request,
	remoteAddr: Deno.Addr,
	identifier?: string,
): AuthThrottleSubject {
	return { clientKey: clientKey(remoteAddr, req.headers), identifier };
}

/** The 429 that refuses a throttled request, with `Retry-After` in whole seconds; `null` admits it. */
export function refuseIfThrottled(
	req: Request,
	action: AuthAction,
	subject: AuthThrottleSubject,
	nowMs: number = Date.now(),
): Response | null {
	const refused = authThrottle.admit(action, subject, nowMs);
	if (!refused) return null;
	const res = toAuthResponse(req, refused);
	const retryAt = Date.parse(String(refused.details?.retryAt ?? ""));
	if (Number.isFinite(retryAt)) {
		res.headers.set("retry-after", String(Math.max(1, Math.ceil((retryAt - nowMs) / 1000))));
	}
	return res;
}

/** Count the outcome of an admitted request (a failed guess counts against its identifier). */
export function noteAuthOutcome(
	action: AuthAction,
	subject: AuthThrottleSubject,
	result: ServiceResult<unknown>,
): void {
	authThrottle.record(action, subject, result);
}
