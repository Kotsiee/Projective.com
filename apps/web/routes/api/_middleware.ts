import { define } from "@web/utils/state.ts";
import { refuseCrossSiteWrite } from "@web/utils/csrf.ts";

/**
 * `/api/*` — every state-changing request must come from this site and carry a JSON body (IW-M2),
 * checked before any handler reads the body. Webhooks and scheduler endpoints are exempt; see
 * `utils/csrf.ts` for the policy.
 */
export default define.middleware((ctx) => {
	const refused = refuseCrossSiteWrite(ctx.req, Deno.env.get("APP_URL"));
	return refused ?? ctx.next();
});
