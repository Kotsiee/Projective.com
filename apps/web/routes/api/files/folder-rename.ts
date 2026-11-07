import { define } from "@web/utils/state.ts";
import { RenameFolderSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/files/folder-rename` — rename one folder.
 *
 * Zod-validates the payload ({@link RenameFolderSchema}) and delegates to the fat
 * {@link FilesBackendService.renameFolder}, which refuses a sibling of the same name, because the hub
 * addresses a folder by its name, and rewrites the `path` of everything beneath it. A mounted folder
 * mirrors its provider and is refused there.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = RenameFolderSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That name is not valid.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(await FilesBackendService.renameFolder(parsed.data, readActor(ctx)));
	},
});
