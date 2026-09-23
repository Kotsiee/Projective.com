import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/files/history?assetId=&actorId=&cursor=&limit=` — a cursor-paged slice of the download
 * ledger for one asset, one actor, or the whole library.
 *
 * Delegates to the fat {@link FilesBackendService.history}. Both filters are optional and compose: an
 * owner auditing a leak filters by `assetId`, a viewer reviewing their own pulls filters by `actorId`.
 *
 * **`actorId` is a FILTER, not an identity claim.** It narrows a ledger the caller may already read;
 * the RLS on `files.download_events` bounds that ledger to events the caller took or on files they own,
 * so no filter can widen it. The routes that DO carry identity (`./download-guard.ts`,
 * `./download-record.ts`) take theirs from the session and accept none from the request.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const limitRaw = sp.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

		return toFilesResponse(
			await FilesBackendService.history({
				assetId: sp.get("assetId") || undefined,
				actorId: sp.get("actorId") || undefined,
				cursor: sp.get("cursor") || null,
				limit: Number.isFinite(limit) ? limit : undefined,
			}, readActor(ctx)),
		);
	},
});
