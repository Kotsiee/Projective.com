import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SwitchContextInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { ContextBackendService } from "@server/services/context/ContextBackendService.ts";

/**
 * `POST /api/context/switch` — thin route: refuse a guest, Zod-validate the target context, then delegate
 * to the fat {@link ContextBackendService.switchContext}, which writes `security.session_context` through
 * the `security` switch RPCs as the calling user (the four active slots are mutually exclusive — one
 * acting identity at a time is a schema invariant, not a UI convention). `contextId` is the entity's row
 * id; `null` returns to acting personally.
 *
 * **This route is only step one of three.** The acting context is stamped into the access token by the
 * GoTrue custom access-token hook, not read per request, so on its own a successful switch changes nothing
 * the browser can see. The caller MUST follow with `POST /api/auth/refresh` and then a **hard**
 * navigation; `useContextSwitch` owns that sequence and is the only sanctioned caller.
 *
 * It lives at `/api/context/*` rather than under `/api/workspace/*` because the acting context is a
 * session-wide concern (it also drives the header account popover, the sidebar's gating and every
 * `/wallet` read), and `organisation` — one of its four targets — is not a workspace kind.
 *
 * Authority over the target is proven by the RPC itself, which resolves the caller from `auth.uid()` and
 * refuses a non-member; the route only establishes that there IS a caller, reading the session the same
 * way every `/api/*` route does (`readActor`: `ctx.state` first, so a just-renewed token wins).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = SwitchContextInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Invalid context switch.");

		const context = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		const result = await ContextBackendService.switchContext(parsed.data, {
			context,
			accessToken: actor.accessToken,
		});
		return toWorkspaceResponse(result);
	},
});
