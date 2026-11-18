import { define } from "@web/utils/state.ts";
import { captchaSiteKeyFor } from "@features/auth/core/captcha.ts";

/**
 * `GET /api/auth/captcha` — the public Turnstile site key, for an auth form without a page handler of
 * its own (the in-page `SignInPrompt` dialog). `null` means no widget renders. Honours the
 * development-only `pj.dev.captcha` override, so it is never cached (Decision #447).
 */
export const handler = define.handlers({
	GET(ctx) {
		return Response.json(
			{ siteKey: captchaSiteKeyFor(ctx.req) },
			{ headers: { "cache-control": "no-store" } },
		);
	},
});
