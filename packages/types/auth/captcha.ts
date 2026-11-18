import { z } from "zod";

/**
 * auth/captcha — the bot check on every anonymous auth write (Decision #447, providers spec §9.1).
 * A Cloudflare Turnstile token rides each sign-up, sign-in, recovery and resend body as
 * {@link CaptchaTokenSchema}; GoTrue verifies it on its own endpoints and the app verifies `/join`'s
 * itself, because `/join` creates the account with the service role, which GoTrue's check skips.
 */

// #region Token
/**
 * A Turnstile response token: single-use, valid for 300 s, at most 2048 characters. Optional in every
 * body, since stub auth and an environment without a site key send none; whether one is required is
 * the verifier's decision, never the schema's.
 */
export const CaptchaTokenSchema = z.string().trim().min(1).max(2048).optional();

/** The Turnstile `action` each protected form runs under; app verification checks it. */
export type CaptchaAction = "join" | "login" | "recover" | "resend";

/** The one refusal a failed, missing or expired bot check answers with. Retryable. */
export const CAPTCHA_REFUSAL = "We couldn't complete the security check. Please try again.";
// #endregion

// #region Dev override
/**
 * The Dev Context Switcher's `captcha` axis: which of Cloudflare's published test key pairs the widget
 * and the app verifier use. `pass` always passes, `fail` always fails (the widget yields no token, so
 * GoTrue refuses too), `interactive` forces a visible challenge. Absent = the environment's own keys.
 * Honoured in development only.
 */
export type CaptchaOverride = "pass" | "fail" | "interactive";

/** The cookie that carries {@link CaptchaOverride}. */
export const CAPTCHA_OVERRIDE_COOKIE = "pj.dev.captcha";

/** Read the override from a cookie value; anything unrecognised means "no override". */
export function parseCaptchaOverride(raw: string | null | undefined): CaptchaOverride | null {
	const value = raw?.trim();
	return value === "pass" || value === "fail" || value === "interactive" ? value : null;
}
// #endregion
