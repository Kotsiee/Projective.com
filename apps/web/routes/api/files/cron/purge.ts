import { define } from "@web/utils/state.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import {
	DEFAULT_PURGE_LIMIT,
	isPurgeCronAuthorised,
	purgeDeletedFiles,
} from "@server/services/files/purge.ts";

/**
 * `POST /api/files/cron/purge?limit=100` — the scheduler's entry point for the purge of soft-deleted
 * bytes, the `files-soft-delete-purge` job (nightly; PROJECTS FL1, Decision #564): a file deleted more
 * than 30 days ago that nothing must keep loses its stored objects, and its row stays with
 * `purged_at` ({@link purgeDeletedFiles}).
 *
 * Authenticated by `OPS_CRON_SECRET` (≥ 32 characters) in constant time; anything else is a 404, as
 * the other cron routes. The body is ignored. Safe to call as often as the scheduler likes: a file is
 * claimed once, and one Storage refused is handed back for the next run.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!isPurgeCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Number(ctx.url.searchParams.get("limit") ?? DEFAULT_PURGE_LIMIT) ||
			DEFAULT_PURGE_LIMIT;
		return serviceResponse(await purgeDeletedFiles(limit));
	},
});
