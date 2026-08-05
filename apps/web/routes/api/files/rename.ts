import { define } from "@web/utils/state.ts";
import { RenameAssetSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";

/**
 * `POST /api/files/rename` — rename one asset.
 *
 * Zod-validates the payload ({@link RenameAssetSchema}) and delegates to the fat
 * {@link FilesBackendService.rename}, which preserves the extension: a person edits the name, not the
 * type. A read-only row (a mounted channel attachment, a connected-drive object) is refused there with
 * a 403, because `canManage` is an authority decision the server owns.
 *
 * **The acting principal comes from the SESSION.** The row's own `canManage` remains the authority —
 * a mounted channel attachment is read-only for everyone — but the service now knows who is asking,
 * which is what an ownership predicate needs the day `FILES_BACKEND_LIVE` goes on.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
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
			await FilesBackendService.rename(parsed.data, actorFromContext(ctx.state.userContext)),
		);
	},
});
