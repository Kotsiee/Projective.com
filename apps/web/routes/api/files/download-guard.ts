import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";

/**
 * `GET /api/files/download-guard?assetId=&device=` — has the acting viewer already taken a copy?
 *
 * Asked before a download so the hub can offer "you downloaded this on Tuesday, open it instead"
 * rather than silently handing over a second copy. Delegates to the fat
 * {@link FilesBackendService.downloadGuard}.
 *
 * **The actor comes from the SESSION, never from the request.** A client-supplied `actorId` would let
 * anyone ask whether somebody else had taken a copy of an asset. It is resolved here from the
 * chrome-only {@link UserContext} the global middleware hydrates; an unresolvable one yields `""`,
 * which the service reads as anonymous.
 *
 * `device` is the opaque, rotating per-browser token that stands in for identity on the anonymous
 * share path only. It is never derived from anything stable about the person or their network, and it
 * is the reason the guard can answer "again?" for a recipient who has no account.
 *
 * This is answered SERVER-side because `localStorage` cannot answer it: that store is per-browser, is
 * wiped, and is wrong the moment the same person opens the asset on their phone.
 *
 * Runs under the caller's own session: RLS is the gate, and the library is the acting context's.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const assetId = sp.get("assetId");
		if (!assetId) {
			return Response.json({ ok: false, message: "Missing file id." }, { status: 400 });
		}

		return toFilesResponse(await FilesBackendService.downloadGuard(assetId, readActor(ctx)));
	},
});
