import { define } from "@web/utils/state.ts";
import { simFromParams } from "@projective/types/files";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `GET /api/integrations/connections` — the Settings → Integrations payload: the catalogue, the
 * caller's own connections, and the two capability projections.
 *
 * Delegates to the fat {@link IntegrationsBackendService.connections}.
 *
 * **The user comes from the SESSION and is never a param.** A connection is a stored authorization to
 * act at a third party on someone's behalf, so accepting a `userId` from the query would let a caller
 * enumerate whose accounts are linked. It is resolved from the chrome-only {@link UserContext}; an
 * unresolvable one yields `""`, which the service answers with no connections rather than someone
 * else's.
 *
 * The rows come from `integrations.v_my_connections`, the definer view that physically cannot project
 * a token column — so no secret can reach this response even by mistake.
 *
 * `hasCalendar` and `hasConferencing` are resolved SEPARATELY by the service because calendar sync and
 * conferencing are two axes, not one chip set: a user may sync a Google calendar and host on Zoom.
 *
 * No server-side capability guard (Decision #53(b)) — see `../files/list.ts`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		return toFilesResponse(
			await IntegrationsBackendService.connections({
				userId: context.userId ?? "",
				sim: simFromParams(ctx.url.searchParams),
			}),
		);
	},
});
