import { define } from "@web/utils/state.ts";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";

const QUERY_MAX = 80;

/**
 * `GET /api/files/access-targets?q=` — the teams, businesses and projects the caller may grant a file
 * to in the Access tab's picker (Decision #402): the ones they belong to, narrowed by `q`. People come
 * from `/api/messaging/suggestions`. Delegates to the fat {@link FilesBackendService.accessTargets}.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, QUERY_MAX);
		return toFilesResponse(await FilesBackendService.accessTargets(q || null, readActor(ctx)));
	},
});
