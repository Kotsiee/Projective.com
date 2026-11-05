import { define } from "@web/utils/state.ts";
import { SetSyncDirectionSchema } from "@projective/types/integrations";
import { readActor } from "@web/utils/api-session.ts";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `POST /api/integrations/sync-direction` — turn a connection's separate Projective calendar on or off
 * (Decision #383, ruling R3). Zod-validates the payload ({@link SetSyncDirectionSchema}) and delegates
 * to the fat {@link IntegrationsBackendService.setSyncDirection}, which proves the connection is the
 * caller's: someone else's answers 404.
 *
 * No server-side capability guard (Decision #53(b)) — see `../files/list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SetSyncDirectionSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That calendar could not be changed.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await IntegrationsBackendService.setSyncDirection(parsed.data, readActor(ctx)),
		);
	},
});
