import { define } from "@web/utils/state.ts";
import type { AssetOwnerType } from "@projective/types/files";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/files/quota[?ownerType=&ownerId=]` — the thin route for a library's storage allowance: the
 * meter, the upgrade nudge and the upload pre-flight.
 *
 * Without an owner it answers for the library the acting context owns. With one, that owner must BE
 * that library — an allowance is a fact about someone's subscription, and `files.get_storage_quota`
 * refuses anyone else's too. Delegates to the fat {@link FilesBackendService.quota}.
 */

const OWNER_TYPES: readonly AssetOwnerType[] = ["user", "team", "business", "organisation"];

export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const ownerType = sp.get("ownerType");
		const ownerId = sp.get("ownerId");
		if ((ownerType || ownerId) && (!ownerType || !ownerId || !OWNER_TYPES.includes(ownerType as AssetOwnerType))) {
			return Response.json({ ok: false, message: "Name both an owner type and an owner, or neither." }, {
				status: 400,
			});
		}
		return toFilesResponse(
			await FilesBackendService.quota(
				readActor(ctx),
				ownerType && ownerId ? { ownerType: ownerType as AssetOwnerType, ownerId } : undefined,
			),
		);
	},
});
