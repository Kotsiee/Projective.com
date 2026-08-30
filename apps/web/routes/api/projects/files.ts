import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { FileKind, FileListPage, FileSortDir, FileSortKey } from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/files` — the thin route for the File Explorer read. HTTP parse +
 * light param guard, then delegate to the fat {@link ProjectBackendService.files} and map its
 * {@link ServiceResult} to the client body via {@link toProjectsBody}. The Zod SSOT
 * (`FileListParamsSchema`) is the shape contract; the route hand-validates the one required param
 * (`projectId`) and coerces the rest, exactly as the sibling `messages`/`detail` routes do. Islands
 * never reach the backend — they fetch this via the dumb `FilesService`.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-`projectId` guard returns its 400 from inside `resolve` rather
 * than from a hand-written `GET`, so that refusal is stated once and `HEAD` reports the same status
 * with the body stripped by the factory. See that module for the caching and CORS decisions.
 */

const SORT_KEYS: readonly FileSortKey[] = ["name", "date", "size", "sender", "type"];
const KINDS: readonly FileKind[] = [
	"image",
	"video",
	"audio",
	"pdf",
	"doc",
	"code",
	"archive",
	"file",
];

export const handler = define.handlers(
	defineReadRoute<{ page: FileListPage }>({
		resolve: (ctx) => {
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

			return ProjectBackendService.files({
				projectId,
				channelId: channelId || null,
				sort,
				dir,
				kinds: kinds.length > 0 ? kinds : undefined,
				query: query || undefined,
				cursor: cursor || null,
				limit: Number.isFinite(limit) ? limit : undefined,
			}, readActor(ctx));
		},
		toBody: toProjectsBody,
	}),
);
