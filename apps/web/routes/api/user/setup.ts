import { define } from "@web/utils/state.ts";
import { readCookies, SB_ACCESS_COOKIE } from "@web/utils/auth-cookies.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";

/**
 * `GET /api/user/setup` — how far the acting person's own profile is set up (the header account
 * popover's completion ring and next-step call to action, computed by
 * `org.fn_compute_profile_setup_progress`), with the verification stamp, the published hours its
 * presence pip derives from and the earned Standing rung.
 *
 * Thin by contract, and shaped exactly like `GET /api/user/me`: resolve the chrome context and the
 * access token, delegate to the fat {@link UserBackendService.setup}, map the result. Self-authorising
 * (the popover renders on authed public routes too): only a genuine guest gets a 401; a read that
 * cannot be made answers `setup: null` so the chrome degrades rather than fails.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		const accessToken = ctx.state.accessToken ?? readCookies(ctx.req)[SB_ACCESS_COOKIE];

		const result = await UserBackendService.setup({ context, accessToken });
		return Response.json(
			{ ok: result.ok, message: result.message, errors: result.errors, ...(result.data ?? {}) },
			{ status: result.status },
		);
	},
});
