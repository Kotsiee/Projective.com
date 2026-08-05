import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";

/**
 * `GET /api/files/history?assetId=&actorId=&cursor=&limit=` — a cursor-paged slice of the download
 * ledger for one asset, one actor, or the whole library.
 *
 * Delegates to the fat {@link FilesBackendService.history}. Both filters are optional and compose: an
 * owner auditing a leak filters by `assetId`, a viewer reviewing their own pulls filters by `actorId`.
 *
 * **`actorId` is forwarded as the client sent it, and that is a scoping decision the live path owns.**
 * It is a FILTER over a ledger the caller may already read, not an identity claim — the two routes
 * that DO carry identity (`./download-guard.ts`, `./download-record.ts`) take theirs from the session
 * and accept none from the request. With `FILES_BACKEND_LIVE` off the fixture ledger is unscoped, so
 * the RLS on `files.download_events` is what must bound this once the gate flips; a thin route is the
 * wrong layer to invent that boundary in (root CLAUDE.md §6 — RLS is always on).
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
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
			}),
		);
	},
});
