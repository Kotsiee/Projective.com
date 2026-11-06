import { define } from "@web/utils/state.ts";
import { SetFolderColorSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `POST /api/files/folder-color` — set a folder's colour, or clear it with `null`.
 *
 * Zod-validates the payload ({@link SetFolderColorSchema}) and delegates to the fat
 * {@link FilesBackendService.setFolderColor}. Runs under the caller's own session: RLS is the gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SetFolderColorSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That colour is not valid.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(await FilesBackendService.setFolderColor(parsed.data, readActor(ctx)));
	},
});
