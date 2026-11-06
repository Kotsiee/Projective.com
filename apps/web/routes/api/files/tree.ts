import { folderSegmentsOfQuery } from "@projective/types/files";
import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

/**
 * `GET /api/files/tree[?scope=workspace&subjectId=|?path=]` — the thin route for a files navigation tree.
 *
 * With no scope it is the `/files` hub's tree, its OWN read rather than a field on the listing envelope
 * because it spans every scope: the acting library (writable), the engagements whose files are mounted
 * into it and the connected drives (both read-only) are three sibling sections, and a merged root would
 * put things the owner cannot rename or delete inside "my files". Whose tree it is comes from the
 * session, never the query.
 *
 * With `scope=workspace` it is one team's or business's drive (the Files module's folder panel); the
 * entity id is a request, honoured only through the caller's active seat in it. Delegates to the fat
 * {@link FilesBackendService.tree}.
 *
 * With `path` it is the children of one mounted node, read when the person opens it
 * ({@link FilesBackendService.treeChildren}): a connected drive's folders or an engagement's
 * submissions, neither of which can be bounded in the tree's one payload.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const scope = sp.get("scope");
		const actor = readActor(ctx);
		const path = folderSegmentsOfQuery(ctx.url.search);
		if (path.length > 0) {
			return toFilesResponse(await FilesBackendService.treeChildren(path, actor));
		}
		if (!scope) return toFilesResponse(await FilesBackendService.tree(actor));
		const subjectId = sp.get("subjectId");
		if (scope !== "workspace" || !subjectId) {
			return Response.json(
				{ ok: false, message: "A tree scope must be `workspace`, with the drive it is for." },
				{ status: 400 },
			);
		}
		return toFilesResponse(await FilesBackendService.tree(actor, { scope, subjectId }));
	},
});
