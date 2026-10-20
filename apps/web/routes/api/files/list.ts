import { define } from "@web/utils/state.ts";
import { AssetListQuerySchema } from "@projective/types/files";
import { readActor } from "@web/utils/api-session.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";

/**
 * `GET /api/files/list?scope=&subjectId=&channelId=&folderId=&path=&sort=&dir=&kinds=&sources=
 * &visibility=&query=&cursor=&limit=` — the thin route for one scope read.
 *
 * Parses the query string through the Zod SSOT ({@link AssetListQuerySchema}), then delegates to the
 * fat {@link FilesBackendService.list} — which answers with the assets, the child folders, the
 * breadcrumb trail, the location's `readOnly` fact and (on a `hub` read) the owner's allowance in one
 * payload. Islands never reach the backend; they fetch this through the dumb `FilesService`.
 *
 * The read runs under the caller's own session, so RLS decides whose files it can see; a `hub` read is
 * the library the acting context owns, never one named in the query, and a `workspace` read is the
 * team or business `subjectId` names only once the caller's active seat in it is confirmed (404
 * otherwise). A `share` read needs no session — the slug is the credential. Signed out, everything
 * else answers 401.
 */
export const handler = define.handlers({
	async GET(ctx) {
		// Reversed so the FIRST value of a repeated key wins, as `searchParams.get` does.
		const parsed = AssetListQuerySchema.safeParse(
			Object.fromEntries([...ctx.url.searchParams].reverse()),
		);
		if (!parsed.success) {
			const message = parsed.error.issues.some((issue) => issue.path[0] === "scope")
				? "Missing or unknown scope."
				: "That file query is not valid.";
			return Response.json({ ok: false, message }, { status: 400 });
		}

		return toFilesResponse(await FilesBackendService.list(parsed.data, readActor(ctx)));
	},
});
