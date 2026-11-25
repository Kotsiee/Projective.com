import { define } from "@web/utils/state.ts";
import { SaveS3ConnectionSchema } from "@projective/types/integrations";
import { readActor } from "@web/utils/api-session.ts";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `POST /api/integrations/s3/save` — finish the caller's pending S3 connection: the bucket's
 * addressing and, for an S3-compatible endpoint, its key pair ({@link SaveS3ConnectionSchema},
 * Decision #314). The service lists the bucket once before anything is stored, and the keys are
 * sealed in the vault, never projected.
 *
 * No server-side capability guard (Decision #53(b)) — see `../../files/list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SaveS3ConnectionSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That storage could not be connected.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await IntegrationsBackendService.saveS3Connection(parsed.data, readActor(ctx)),
		);
	},
});
