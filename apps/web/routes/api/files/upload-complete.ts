import { define } from "@web/utils/state.ts";
import { UploadCompleteSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/files/upload-complete` — step 3 of the upload handshake: the object landed, so the row
 * leaves `pending_upload`.
 *
 * Zod-validates the receipt ({@link UploadCompleteSchema}) and delegates to the fat
 * {@link FilesBackendService.uploadComplete}. `etag` is the storage provider's receipt and is nullable
 * because not every provider returns one.
 *
 * The live path leaves the row `scanning` until the virus/MIME check clears rather than promoting it
 * straight to `uploaded`, because a row that says `uploaded` is a row the hub will hand to someone.
 *
 * **The acting principal comes from the SESSION**, so finalising an upload can be bounded to the row the
 * caller started rather than to any id that parses.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UploadCompleteSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That upload could not be finalised.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.uploadComplete(
				parsed.data,
				actorFromContext(ctx.state.userContext),
			),
		);
	},
});
