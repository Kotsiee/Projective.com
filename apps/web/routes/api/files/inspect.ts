import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";

/**
 * `GET /api/files/inspect?id=&share=` — the thin route for one asset's inspector DTO, read by the
 * preview modal before it mounts the inspector's canvas in place. Delegates to the fat
 * {@link FilesBackendService.inspect}, which answers `404` for every refusal (missing, unreadable,
 * malformed id, a share slug that does not reach the file) and `503` when the read itself fails.
 *
 * Runs under the caller's own session; a `share` slug authorises an anonymous read exactly as it does
 * on `/inspect/[fileId]`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const id = sp.get("id");
		if (!id) {
			return Response.json({ ok: false, message: "Missing file id." }, { status: 400 });
		}
		const result = await FilesBackendService.inspect(
			id,
			{ share: sp.get("share") || null },
			readActor(ctx),
		);
		return toFilesResponse(result);
	},
});
