import { define } from "@web/utils/state.ts";
import { SetItemAccessSchema } from "@projective/types/files";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/files/access?id=` · `POST /api/files/access` — the inspector's Access tab (Decision #402).
 *
 * GET answers who may open one file as the caller may know it; POST saves its tier, its library's
 * member switch and its whole grant list in one write ({@link SetItemAccessSchema}). Both delegate to
 * the fat {@link FilesBackendService}, which runs under the caller's own session: the definer RPCs
 * behind it decide who may change what, and every refusal to read is the same 404.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = ctx.url.searchParams.get("id");
		if (!id) return Response.json({ ok: false, message: "Missing file id." }, { status: 400 });
		return toFilesResponse(await FilesBackendService.access(id, readActor(ctx)));
	},

	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = SetItemAccessSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Those access changes are not valid.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}
		return toFilesResponse(await FilesBackendService.setAccess(parsed.data, readActor(ctx)));
	},
});
