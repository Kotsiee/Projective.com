import { define } from "@web/utils/state.ts";
import { CopyAssetsSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/files/copy` — copy assets and folders into a folder of the same library. `targetFolderId:
 * null` is the library root, which is a real destination and not "unset".
 *
 * Zod-validates the payload ({@link CopyAssetsSchema}, bounded so a malformed client cannot ask for the
 * world) and delegates to the fat {@link FilesBackendService.copy}, which reports the count that
 * actually landed. The acting principal comes from the SESSION, and only what that person owns copies.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = CopyAssetsSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Those files could not be copied.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(await FilesBackendService.copy(parsed.data, readActor(ctx)));
	},
});
