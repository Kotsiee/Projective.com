import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import type { AssetOwnerType, FileScope } from "@projective/types/files";

/**
 * `GET /api/files/tree?scope=&subjectId=&ownerType=&ownerId=` — the thin route for the `/files`
 * navigation tree.
 *
 * The tree is its OWN read rather than a field on the listing envelope because it spans every scope:
 * the owner's writable library, the read-only mounted engagements and the connected drives are three
 * sibling sections, and a merged root would put things the owner cannot rename or delete inside "my
 * files". Delegates to the fat {@link FilesBackendService.tree}.
 *
 * The simulation overlay is deliberately NOT read here — {@link FilesBackendService.tree} takes no
 * `sim` argument, so parsing one would imply an effect the service does not have.
 *
 * No server-side capability guard (Decision #53(b)) — see `./list.ts`.
 */

// #region Allow-lists
const SCOPES: readonly FileScope[] = [
	"channel",
	"project",
	"conversation",
	"hub",
	"drive",
	"share",
];
const OWNER_TYPES: readonly AssetOwnerType[] = ["user", "team", "business", "organisation"];
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const scope = sp.get("scope");
		const ownerType = sp.get("ownerType");
		const ownerId = sp.get("ownerId");

		if (!scope || !SCOPES.includes(scope as FileScope)) {
			return Response.json({ ok: false, message: "Missing or unknown scope." }, { status: 400 });
		}
		if (!ownerType || !OWNER_TYPES.includes(ownerType as AssetOwnerType)) {
			return Response.json({ ok: false, message: "Missing or unknown owner type." }, {
				status: 400,
			});
		}
		if (!ownerId) {
			return Response.json({ ok: false, message: "Missing owner." }, { status: 400 });
		}

		return toFilesResponse(
			await FilesBackendService.tree({
				scope: scope as FileScope,
				subjectId: sp.get("subjectId") || null,
				ownerType: ownerType as AssetOwnerType,
				ownerId,
			}),
		);
	},
});
