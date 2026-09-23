import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { resolveConnections } from "@web/features/files/core/integrations-ssr.ts";
import { IntegrationsService } from "@web/features/files/core/IntegrationsService.ts";
import IntegrationsConsole from "@web/features/files/islands/IntegrationsConsole.island.tsx";

/**
 * `/settings/integrations` — the connector console, and the first producer of the already-designed
 * `ConnectionsView` shape.
 *
 * Thin controller: resolve the acting user from the SESSION, resolve the payload through the fat
 * service, hand it to the island — with the reason when it could not be read, so an outage is never
 * shown as "nothing connected". The guest bounce is the `(dashboard)` middleware's job; RLS under the
 * caller's JWT is the real gate, and `integrations.user_connections` is read through
 * `v_my_connections`, the definer view that physically cannot project a token column.
 *
 * **The user is never a parameter.** A connection is a stored authorization to act at a third party
 * on someone's behalf, so accepting a `userId` from the query would let a caller enumerate whose
 * accounts are linked. It comes from `ctx.state.userContext`; an unresolvable one yields `""`, which
 * the service answers with no connections rather than with somebody else's.
 *
 * ## `returnTo` is computed here, not in the browser
 *
 * The consent round trip has to come back somewhere, and the path is passed INTO the island rather
 * than read off `location` inside it, so the first Connect works identically before hydration has
 * settled and in a re-render. It is a same-origin PATH — `ctx.url.pathname`, never `ctx.url.href` —
 * because the server validates it as one and refuses an absolute URL: an attacker-chosen return
 * target turns a provider's consent screen into an open redirect wearing this domain's credibility.
 *
 * The `?connect=` marker the callback redirects with is read here through the same
 * `IntegrationsService.completionFrom` the client would use, so SSR and a client re-read cannot
 * disagree about whether a consent just happened. It is deliberately two-valued: the callback is
 * unauthenticated, and distinguishing "expired state" from "unknown state" in a user-visible URL
 * would tell a prober which states exist.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const { view, error } = await resolveConnections(readActor(ctx));

		ctx.state.title = "Integrations · Settings · Projective";

		return page({
			view,
			error,
			returnTo: ctx.url.pathname,
			outcome: IntegrationsService.completionFrom(ctx.url),
		});
	},
});

export default define.page<typeof handler>(function IntegrationsSettingsPage({ data }) {
	return (
		<IntegrationsConsole
			initial={data.view}
			initialError={data.error}
			returnTo={data.returnTo}
			outcome={data.outcome}
		/>
	);
});
