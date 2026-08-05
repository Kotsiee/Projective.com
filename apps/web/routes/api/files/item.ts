import { define } from "@web/utils/state.ts";
import { simFromParams } from "@projective/types/files";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";

/**
 * `GET /api/files/item?id=` — the thin route for one asset's full row: the preview modal's deep link,
 * and the refresh a surface issues after a mutation. Delegates to the fat
 * {@link FilesBackendService.item}, which answers 404 for an id that resolves to nothing.
 *
 * `canManage` and `downloadedByViewer` on the returned row are SERVER-derived and must stay that way —
 * `canManage` is an authority decision (a mounted channel attachment is read-only in the hub as a
 * matter of product rule, not of ownership arithmetic), and `downloadedByViewer` cannot be answered
 * from `localStorage` at all. This route adds nothing to either.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const id = ctx.url.searchParams.get("id");
		if (!id) {
			return Response.json({ ok: false, message: "Missing file id." }, { status: 400 });
		}
		return toFilesResponse(await FilesBackendService.item(id, simFromParams(ctx.url.searchParams)));
	},
});
