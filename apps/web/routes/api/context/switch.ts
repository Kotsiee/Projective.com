import { define } from "@web/utils/state.ts";
import { SwitchContextInputSchema } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { readCookies, SB_ACCESS_COOKIE } from "@web/utils/auth-cookies.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { ContextBackendService } from "@server/services/context/ContextBackendService.ts";

/**
 * `POST /api/context/switch` — thin route: Zod-validate the target context, resolve the session facts, then
 * delegate to the fat {@link ContextBackendService.switchContext}, which writes
 * `security.session_context` (whose four active slots are **mutually exclusive** — one acting identity at a
 * time is a schema invariant, not a UI convention).
 *
 * **This route is only step one of three.** The acting context is stamped into the access token by the
 * GoTrue custom access-token hook, not read per request, so on its own a successful switch changes nothing
 * the browser can see: the token still carries the PREVIOUS context, every band keeps rendering the old
 * identity, and RLS keeps enforcing the old claims. The caller MUST follow with
 * `POST /api/auth/refresh` and then a **hard** navigation. `useContextSwitch` owns that sequence and is the
 * only sanctioned caller — see its module doc for why omitting the refresh produces a screen that is wrong
 * in a way the reader cannot detect.
 *
 * It lives at `/api/context/*` rather than under `/api/workspace/*` on purpose: the acting context is a
 * session-wide concern that outlives this feature (it also drives the header account popover, the sidebar's
 * gating and every `/wallet` read), and `organisation` — one of its four targets — is not a workspace kind.
 *
 * **No capability guard beyond the `(dashboard)` group's own.** A switch is authenticated, not
 * capability-gated: the fat service requires a session, and *authority over the target* is proven by the
 * `security` RPC itself, which resolves the actor from `auth.uid()` and raises for a non-member. Gating here
 * would also break the client-side Dev Context Switcher, whose simulated persona the server never sees.
 *
 * The access token is read the same way `/api/user/me` reads it — `ctx.state.accessToken` when the dashboard
 * guard has just silently renewed the session (the request cookie is stale until its `Set-Cookie` lands),
 * else the cookie — so a switch made on a just-refreshed request is scoped to the new token rather than a
 * token that no longer exists.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SwitchContextInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Invalid context switch.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}

		const context = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		const accessToken = ctx.state.accessToken ?? readCookies(ctx.req)[SB_ACCESS_COOKIE];

		const result = await ContextBackendService.switchContext(parsed.data, { context, accessToken });
		return toWorkspaceResponse(result);
	},
});
