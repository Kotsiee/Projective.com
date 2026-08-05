import { define } from "@web/utils/state.ts";
import { RevokeConnectionSchema } from "@projective/types/integrations";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `POST /api/integrations/revoke` — revoke a stored authorization. Terminal: reconnecting requires
 * fresh consent.
 *
 * Zod-validates the payload ({@link RevokeConnectionSchema}) and delegates to the fat
 * {@link IntegrationsBackendService.revokeConnection}, which also deletes the vault row AND calls the
 * provider's own revocation endpoint on the live path — leaving a token valid at the far end after the
 * user asked us to forget it is the one failure they would never find out about.
 *
 * **The owner check is the service's, and it needs the session user.** Passing the acting
 * {@link UserContext}'s id is what lets the service answer 404 for a connection the caller does not
 * hold, rather than revoking someone else's grant from a guessed id.
 *
 * `POST` rather than `DELETE`, matching every other mutation in this codebase: the payload is a JSON
 * body, and a body on a `DELETE` is permitted by the spec but discarded by enough proxies and clients
 * to be a bad bet.
 *
 * No server-side capability guard (Decision #53(b)) — see `../files/list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = RevokeConnectionSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That connection could not be revoked.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		const context = asAuthenticatedContext(ctx.state.userContext);
		return toFilesResponse(
			await IntegrationsBackendService.revokeConnection(parsed.data, {
				userId: context.userId ?? "",
			}),
		);
	},
});
