import { define } from "@web/utils/state.ts";
import { readCookies, SB_ACCESS_COOKIE } from "@web/utils/auth-cookies.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";

/**
 * `GET /api/user/me` — the acting user's account projection for the header account popover.
 *
 * Thin by contract: it resolves the request's chrome {@link UserContext} (from `ctx.state`, populated
 * site-wide by the global middleware, falling back to a fresh decode of the `sb-access-token` cookie)
 * and the access token (the guard-renewed `ctx.state.accessToken` when present, else the cookie), then
 * delegates to the fat {@link UserBackendService}. Not behind the `(dashboard)` guard — the popover
 * renders on authed public routes too — so it self-authorises: the service returns 401 only for a
 * genuine guest, which the client 401-interceptor routes through a silent refresh + retry.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		const accessToken = ctx.state.accessToken ?? readCookies(ctx.req)[SB_ACCESS_COOKIE];

		const result = await UserBackendService.me({ context, accessToken });
		return Response.json(
			{ ok: result.ok, message: result.message, errors: result.errors, ...(result.data ?? {}) },
			{ status: result.status },
		);
	},
});
