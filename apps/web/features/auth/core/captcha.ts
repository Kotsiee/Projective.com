import {
	CAPTCHA_OVERRIDE_COOKIE,
	type CaptchaAction,
	parseCaptchaOverride,
} from "@projective/types/auth";
import { serverEnv } from "@projective/backend/core/env.ts";
import { isAuthBackendLive } from "@projective/backend/core/supabase.ts";
import {
	checkJoinCaptcha,
	resolveTurnstileKeys,
	type TurnstileKeys,
} from "@server/services/auth/captcha.ts";
import { readCookies } from "@web/utils/auth-cookies.ts";
import { isDevelopmentEnv } from "@web/utils/app-env.ts";
import { clientKey } from "@web/utils/client-key.ts";
import { toAuthResponse } from "./respond.ts";

/**
 * captcha — the auth pages' and routes' side of the Turnstile check (Decision #447). Server-only.
 * The key pair is resolved per request so the Dev Context Switcher's `pj.dev.captcha` cookie can swap
 * in a Cloudflare test pair, honoured only under `DENO_ENV=development`.
 */

/** The Turnstile key pair this request uses. */
export function captchaKeysFor(req: Request): TurnstileKeys {
	const env = serverEnv();
	const development = isDevelopmentEnv();
	return resolveTurnstileKeys({
		siteKey: env.turnstileSiteKey,
		secretKey: env.turnstileSecretKey,
		development,
		override: development ? parseCaptchaOverride(readCookies(req)[CAPTCHA_OVERRIDE_COOKIE]) : null,
	});
}

/** The public site key a page hands its auth island; `null` renders no widget. */
export function captchaSiteKeyFor(req: Request): string | null {
	return captchaKeysFor(req).siteKey;
}

function appHostnames(): string[] {
	try {
		return [new URL(serverEnv().appUrl).hostname];
	} catch {
		return [];
	}
}

/**
 * The app-verified bot check for an anonymous write outside auth (the newsletter opt-in), bound to
 * this request: its key pair (honouring the development override), its client address and the app's
 * hostname. The fat service calls it before its write; `null` admits the request, otherwise it is
 * the {@link ServiceResult} refusal to answer with.
 */
export function appCaptchaGate(req: Request, remoteAddr: Deno.Addr, action: CaptchaAction) {
	return (token: string | undefined) =>
		checkJoinCaptcha({
			token,
			keys: captchaKeysFor(req),
			action,
			remoteIp: clientKey(remoteAddr, req.headers),
			allowedHostnames: appHostnames(),
			development: isDevelopmentEnv(),
		});
}

/**
 * Verify a token the app checks itself (`/join`). `null` admits the request; otherwise the response
 * to refuse it with (400 for a failed token, 503 when the check cannot run). Stub auth writes no
 * account, so it checks nothing.
 */
export async function refuseIfCaptchaFails(
	req: Request,
	remoteAddr: Deno.Addr,
	action: CaptchaAction,
	token: string | undefined,
): Promise<Response | null> {
	if (!isAuthBackendLive()) return null;
	const refused = await checkJoinCaptcha({
		token,
		keys: captchaKeysFor(req),
		action,
		remoteIp: clientKey(remoteAddr, req.headers),
		allowedHostnames: appHostnames(),
		development: isDevelopmentEnv(),
	});
	return refused ? toAuthResponse(req, refused) : null;
}
