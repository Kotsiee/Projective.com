import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/files/tree` — the thin route for the `/files` navigation tree.
 *
 * The tree is its OWN read rather than a field on the listing envelope because it spans every scope:
 * the acting library (writable), the engagements whose files are mounted into it and the connected
 * drives (both read-only) are three sibling sections, and a merged root would put things the owner
 * cannot rename or delete inside "my files". Whose tree it is comes from the session, never the query.
 * Delegates to the fat {@link FilesBackendService.tree}.
 */
export const handler = define.handlers({
	async GET(ctx) {
		return toFilesResponse(await FilesBackendService.tree(readActor(ctx)));
	},
});
