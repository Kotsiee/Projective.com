import { CAPTCHA_REFUSAL, type CaptchaAction } from "@projective/types/auth";
import { fail, type ServiceResult } from "../ServiceResult.ts";
import { type TurnstileKeys, verifyTurnstile } from "../../core/turnstile.ts";
export { resolveTurnstileKeys, type TurnstileKeys } from "../../core/turnstile.ts";

/**
 * captcha — the auth services' side of the bot check (Decision #447). GoTrue's own refusal and the
 * app's `/join` verdict both surface as the one retryable {@link CAPTCHA_REFUSAL}; Cloudflare being
 * unreachable, or no secret outside development, is a 503 instead, because retrying the check will
 * not help the person.
 */

/** The 503 copy when the check itself cannot run. */
export const CAPTCHA_UNAVAILABLE =
	"We couldn't run the security check just now. Please try again in a moment.";

/** The refusal a failed, missing or expired token answers with. */
export function captchaRefused<T = never>(): ServiceResult<T> {
	return fail(400, { message: CAPTCHA_REFUSAL });
}

/** Whether a GoTrue error is its CAPTCHA refusal (`captcha_failed`, a missing or rejected token). */
export function isGoTrueCaptchaRefusal(error: unknown): boolean {
	return typeof error === "object" && error !== null &&
		(error as { code?: unknown }).code === "captcha_failed";
}

/** What {@link checkJoinCaptcha} verifies. */
export interface JoinCaptchaInput {
	token: string | undefined;
	keys: TurnstileKeys;
	action: CaptchaAction;
	remoteIp: string | null;
	allowedHostnames: readonly string[];
	development: boolean;
	fetchImpl?: typeof fetch;
}

/**
 * Verify a token the app must check itself: `/join`, whose account GoTrue's check never sees, and the
 * newsletter opt-in (action `newsletter`), which mails whatever address it is given.
 * `null` admits the request; otherwise the refusal to answer with.
 */
export async function checkJoinCaptcha(
	input: JoinCaptchaInput,
): Promise<ServiceResult<never> | null> {
	const verdict = await verifyTurnstile({
		token: input.token,
		secretKey: input.keys.secretKey,
		action: input.action,
		remoteIp: input.remoteIp,
		allowedHostnames: input.allowedHostnames,
		development: input.development,
		fetchImpl: input.fetchImpl,
	});
	if (verdict.ok) return null;
	if (verdict.reason === "unavailable" || verdict.reason === "unconfigured") {
		return fail(503, { message: CAPTCHA_UNAVAILABLE });
	}
	return captchaRefused();
}
