import { define } from "@web/utils/state.ts";
import { RenameAssetSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/files/rename` — rename one asset.
 *
 * Zod-validates the payload ({@link RenameAssetSchema}) and delegates to the fat
 * {@link FilesBackendService.rename}, which preserves the extension: a person edits the name, not the
 * type. A read-only row (a mounted channel attachment, a connected-drive object) is refused there with
 * a 403, because `canManage` is an authority decision the server owns.
 *
 * **The acting principal comes from the SESSION**, and only the person who created a file may rename
 * it — the same predicate the `files.items` UPDATE policy enforces.
 *
 * Runs under the caller's own session: RLS is the gate, and the library is the acting context's.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = RenameAssetSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That name is not valid.", errors: toFieldErrors(parsed.error) },
				{ status: 422 },
			);
		}
		return toFilesResponse(
			await FilesBackendService.rename(parsed.data, readActor(ctx)),
		);
	},
});
