import { define } from "@web/utils/state.ts";
import { toProjectsResponse } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { FileKind, FileSortDir, FileSortKey } from "@projective/types/projects";

/**
 * `/api/projects/files` — the thin route for the File Explorer read. HTTP parse + light param guard,
 * then delegate to the fat {@link ProjectBackendService.files} and map its {@link ServiceResult} to a
 * `Response` via {@link toProjectsResponse}. The Zod SSOT (`FileListParamsSchema`) is the shape
 * contract; the route hand-validates the one required param (`projectId`) and coerces the rest, exactly
 * as the sibling `messages`/`detail` routes do. Islands never reach the backend — they fetch this via
 * the dumb `FilesService`.
 */

const SORT_KEYS: readonly FileSortKey[] = ["name", "date", "size", "sender", "type"];
const KINDS: readonly FileKind[] = ["image", "video", "audio", "pdf", "doc", "code", "archive", "file"];

export const handler = define.handlers({
	GET(ctx) {
		const projectId = ctx.url.searchParams.get("projectId");
		if (!projectId) {
			return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
		}

		const sp = ctx.url.searchParams;
		const channelId = sp.get("channelId");
		const sortRaw = sp.get("sort");
		const dirRaw = sp.get("dir");
		const query = sp.get("query") ?? undefined;
		const cursor = sp.get("cursor");
		const limitRaw = sp.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

		const sort = sortRaw && SORT_KEYS.includes(sortRaw as FileSortKey)
			? (sortRaw as FileSortKey)
			: undefined;
		const dir = dirRaw === "asc" || dirRaw === "desc" ? (dirRaw as FileSortDir) : undefined;
		const kinds = (sp.get("kinds") ?? "")
			.split(",")
			.map((k) => k.trim())
			.filter((k): k is FileKind => KINDS.includes(k as FileKind));

		return toProjectsResponse(
			ProjectBackendService.files({
				projectId,
				channelId: channelId || null,
				sort,
				dir,
				kinds: kinds.length > 0 ? kinds : undefined,
				query: query || undefined,
				cursor: cursor || null,
				limit: Number.isFinite(limit) ? limit : undefined,
			}),
		);
	},
});
