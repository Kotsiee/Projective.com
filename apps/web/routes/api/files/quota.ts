import { define } from "@web/utils/state.ts";
import { simFromParams } from "@projective/types/files";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { actorFromContext } from "@server/services/files/acting-principal.ts";
import type { AssetOwnerType } from "@projective/types/files";

/**
 * `GET /api/files/quota?ownerType=&ownerId=` — the thin route for a principal's resolved storage
 * allowance: the meter, the upgrade nudge and the upload pre-flight.
 *
 * Every figure on the returned {@link StorageQuota} is computed by the fat
 * {@link FilesBackendService.quota} and rendered verbatim by the client, which never subtracts,
 * divides or totals them — the same rule that keeps money arithmetic off the client on `/wallet`
 * (Decision #60). **The unit is MEBIBYTES**, because every boundary-crossing figure in the entitlement
 * engine is Postgres `int4` and a 25 GB allowance in bytes overflows it.
 *
 * The simulation overlay IS read here: {@link FilesBackendService.quota} accepts it, and every band it
 * reaches (warning · critical · exceeded · unlimited) is a server-derived projection the client cannot
 * fake for itself.
 *
 * **The owner in the query is a REQUEST, not the answer.** This is a read, so the query still names the
 * principal whose allowance is wanted — but the acting principal travels alongside it from
 * `ctx.state.userContext`, and the service scopes the answer to a principal the session evidences once
 * `FILES_BACKEND_LIVE` is on. An allowance is a fact about a real subscription and a plan tier, and
 * neither belongs to whoever happens to type the id.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */

// #region Allow-lists
const OWNER_TYPES: readonly AssetOwnerType[] = ["user", "team", "business", "organisation"];
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const ownerType = sp.get("ownerType");
		const ownerId = sp.get("ownerId");

		if (!ownerType || !OWNER_TYPES.includes(ownerType as AssetOwnerType)) {
			return Response.json({ ok: false, message: "Missing or unknown owner type." }, {
				status: 400,
			});
		}
		if (!ownerId) {
			return Response.json({ ok: false, message: "Missing owner." }, { status: 400 });
		}

		return toFilesResponse(
			await FilesBackendService.quota({
				ownerType: ownerType as AssetOwnerType,
				ownerId,
				sim: simFromParams(sp),
			}, actorFromContext(ctx.state.userContext)),
		);
	},
});
