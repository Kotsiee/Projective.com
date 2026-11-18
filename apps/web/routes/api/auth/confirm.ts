import { define } from "@web/utils/state.ts";
import { ConfirmLinkSchema } from "@features/auth/core/schema.ts";
import { DEFAULT_REDIRECT } from "@features/auth/core/redirect.ts";
import {
	CONFIRM_FAILED_PATH,
	CONFIRM_PAGE_PATH,
	CONFIRM_THROTTLED_NOTICE,
	confirmPageHref,
	confirmRedirect,
} from "@features/auth/core/confirm-link.ts";
import { authSubject, refuseIfThrottled } from "@features/auth/core/throttle.ts";
import { sessionSetCookies } from "@web/utils/auth-cookies.ts";
import { AuthBackendService } from "@server/services/auth/AuthBackendService.ts";

/**
 * `/api/auth/confirm` — spends the confirmation email's one-time `token_hash` (Decision #445).
 *
 * - `GET` spends nothing. It is the link older emails carry, so it `303`s to the confirm page with
 *   the same query, where the person presses Confirm. A mail scanner that opens it changes nothing.
 * - `POST` is that press: a plain form body (the `/api` guard checks it came from this site), Zod,
 *   the per-client throttle, then the fat {@link AuthBackendService} exchanges the token with GoTrue.
 *   Success lands the now-signed-in person on `/home` with their session cookies. A malformed, expired
 *   or spent token lands on `/login` with a notice. A throttled press returns to the page with the
 *   token still unspent.
 */
export const handler = define.handlers({
	GET(ctx) {
		return confirmRedirect(`${CONFIRM_PAGE_PATH}${ctx.url.search}`);
	},

	async POST(ctx) {
		const form = await ctx.req.formData().catch(() => null);
		const parsed = ConfirmLinkSchema.safeParse({
			token_hash: form?.get("token_hash"),
			type: form?.get("type"),
		});
		if (!parsed.success) return confirmRedirect(CONFIRM_FAILED_PATH);

		const subject = authSubject(ctx.req, ctx.info.remoteAddr);
		if (refuseIfThrottled(ctx.req, "confirm", subject)) {
			return confirmRedirect(confirmPageHref(parsed.data, CONFIRM_THROTTLED_NOTICE));
		}

		const result = await AuthBackendService.confirmEmailLink({
			tokenHash: parsed.data.token_hash,
			redirectTo: DEFAULT_REDIRECT,
		});
		if (!result.ok) return confirmRedirect(CONFIRM_FAILED_PATH);

		return confirmRedirect(
			result.data?.redirectTo ?? DEFAULT_REDIRECT,
			result.session ? sessionSetCookies(ctx.req, result.session) : [],
		);
	},
});
