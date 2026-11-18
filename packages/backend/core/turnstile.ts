/**
 * turnstile — Cloudflare Turnstile key resolution and app-side token verification (Decision #447,
 * providers spec §9.1).
 *
 * GoTrue verifies the token on its own captcha-gated endpoints (password grant, recover, resend). The
 * app verifies only where GoTrue cannot: `/join` creates the account with the service role, and GoTrue
 * skips its check for admin credentials. Cloudflare's published test keys count only under
 * `DENO_ENV=development`; anywhere else they are treated as absent, so a copied `.env.example` fails
 * closed instead of accepting the test token every bot can send.
 */

import type { CaptchaAction, CaptchaOverride } from "@projective/types/auth";

// #region Keys
/** Cloudflare's published Turnstile test keys (developers.cloudflare.com/turnstile/troubleshooting/testing). */
export const TURNSTILE_TEST_KEYS = {
	site: {
		pass: "1x00000000000000000000AA",
		fail: "2x00000000000000000000AB",
		interactive: "3x00000000000000000000FF",
	},
	secret: {
		pass: "1x0000000000000000000000000000000AA",
		fail: "2x0000000000000000000000000000000AA",
	},
} as const;

const TEST_KEY = /^[123]x0+[A-F]{2}$/;
const PLACEHOLDER = "XXXX-XXXX";

/** Whether `key` is one of Cloudflare's test site or secret keys. */
export function isTurnstileTestKey(key: string): boolean {
	return TEST_KEY.test(key.trim());
}

/** The site key a widget renders with and the secret its token is verified against; `null` = none. */
export interface TurnstileKeys {
	siteKey: string | null;
	secretKey: string | null;
}

/** What {@link resolveTurnstileKeys} decides from. */
export interface TurnstileKeyInput {
	siteKey: string | undefined;
	secretKey: string | undefined;
	development: boolean;
	override: CaptchaOverride | null;
}

function usableKey(key: string | undefined, development: boolean): string | null {
	const value = key?.trim();
	if (!value || value === PLACEHOLDER) return null;
	if (!development && isTurnstileTestKey(value)) return null;
	return value;
}

/**
 * The key pair a request uses. Under development a `pj.dev.captcha` override swaps in a matching test
 * pair; otherwise the environment's pair, with the placeholder (and, outside development, any test
 * key) counting as absent.
 */
export function resolveTurnstileKeys(input: TurnstileKeyInput): TurnstileKeys {
	if (input.development && input.override) {
		return {
			siteKey: TURNSTILE_TEST_KEYS.site[input.override],
			secretKey: input.override === "fail"
				? TURNSTILE_TEST_KEYS.secret.fail
				: TURNSTILE_TEST_KEYS.secret.pass,
		};
	}
	return {
		siteKey: usableKey(input.siteKey, input.development),
		secretKey: usableKey(input.secretKey, input.development),
	};
}
// #endregion

// #region Verification
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 3_000;
const TOKEN_MAX_AGE_MS = 300_000;

/**
 * The outcome of an app-side check. `skipped`: development with no secret, so nothing was checked.
 * `missing` and `refused` are the person's to retry; `unavailable` (Cloudflare unreachable) and
 * `unconfigured` (no secret outside development) refuse the write as a 503.
 */
export type TurnstileVerdict =
	| { ok: true; skipped: boolean }
	| { ok: false; reason: "missing" | "refused" | "unavailable" | "unconfigured" };

/** What {@link verifyTurnstile} checks. */
export interface TurnstileVerifyInput {
	token: string | undefined;
	secretKey: string | null;
	action: CaptchaAction;
	remoteIp?: string | null;
	/** The hostnames a real token may have been solved on; empty skips the hostname check. */
	allowedHostnames: readonly string[];
	development: boolean;
	fetchImpl?: typeof fetch;
	nowMs?: number;
}

interface SiteverifyReply {
	success?: boolean;
	hostname?: string;
	action?: string;
	challenge_ts?: string;
	metadata?: { result_with_testing_key?: boolean };
}

function acceptsReply(reply: SiteverifyReply, input: TurnstileVerifyInput, nowMs: number): boolean {
	if (reply.success !== true) return false;
	if (reply.metadata?.result_with_testing_key === true) return input.development;
	if (input.allowedHostnames.length > 0 && !input.allowedHostnames.includes(reply.hostname ?? "")) {
		return false;
	}
	if (reply.action !== input.action) return false;
	const solvedAt = Date.parse(reply.challenge_ts ?? "");
	return Number.isFinite(solvedAt) && nowMs - solvedAt <= TOKEN_MAX_AGE_MS;
}

/**
 * Verify a Turnstile token with Cloudflare's siteverify: success, the expected hostname and action,
 * solved within 300 s. A test-key reply carries neither hostname nor action and passes only in
 * development. The secret and the token are never logged.
 */
export async function verifyTurnstile(input: TurnstileVerifyInput): Promise<TurnstileVerdict> {
	if (!input.secretKey) {
		if (input.development) {
			console.info("[turnstile] no secret configured; development skips the check");
			return { ok: true, skipped: true };
		}
		return { ok: false, reason: "unconfigured" };
	}
	const token = input.token?.trim();
	if (!token) return { ok: false, reason: "missing" };

	const form = new URLSearchParams({
		secret: input.secretKey,
		response: token,
		idempotency_key: crypto.randomUUID(),
	});
	if (input.remoteIp) form.set("remoteip", input.remoteIp);

	let reply: SiteverifyReply;
	try {
		const res = await (input.fetchImpl ?? fetch)(SITEVERIFY_URL, {
			method: "POST",
			body: form,
			signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
		});
		if (!res.ok) {
			console.error("[turnstile] siteverify answered", res.status);
			return { ok: false, reason: "unavailable" };
		}
		reply = await res.json() as SiteverifyReply;
	} catch (e) {
		console.error("[turnstile] siteverify unreachable", e instanceof Error ? e.name : "error");
		return { ok: false, reason: "unavailable" };
	}
	return acceptsReply(reply, input, input.nowMs ?? Date.now())
		? { ok: true, skipped: false }
		: { ok: false, reason: "refused" };
}
// #endregion
