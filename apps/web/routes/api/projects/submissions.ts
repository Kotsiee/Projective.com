import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toProjectsBody } from "@features/projects/core/respond.ts";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type {
	FileKind,
	FileSortDir,
	FileSortKey,
	SubmissionListPage,
} from "@projective/types/projects";

/**
 * `GET | HEAD | OPTIONS /api/projects/submissions` — the thin route for the Submissions explorer
 * read. HTTP parse + light param guard, then delegate to the fat
 * {@link ProjectBackendService.submissions} and map its {@link ServiceResult} to the client body via
 * {@link toProjectsBody}. The Zod SSOT (`SubmissionListParamsSchema`) is the shape contract; the
 * route hand-validates the one required param (`projectId`) and coerces the rest, exactly as the
 * sibling `files`/`messages` routes do. The tree `path` arrives as a slash-joined string
 * (`path=stage-0/mara/unit-1`) and is split into segments. Islands never reach the backend — they
 * fetch this via the dumb `SubmissionsService`.
 *
 * All three verbs come from {@link defineReadRoute}, which resolves the payload ONCE and derives the
 * responses from it — so `HEAD` cannot drift from `GET`, and the `ETag`/`If-None-Match` revalidation
 * is identical on both. The missing-`projectId` guard returns its 400 from inside the resolver for
 * the same reason: the factory strips the body for `HEAD`, so the refusal cannot leak a body through
 * a verb that must not carry one.
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
	defineReadRoute<{ page: SubmissionListPage }>({
		resolve: (ctx) => {
			const projectId = ctx.url.searchParams.get("projectId");
			if (!projectId) {
				return Response.json({ ok: false, message: "Missing projectId." }, { status: 400 });
			}

			const sp = ctx.url.searchParams;
			const channelId = sp.get("channelId");
			const pathRaw = sp.get("path") ?? "";
			const path = pathRaw
				.split("/")
				.map((s) => s.trim())
				.filter(Boolean)
				.slice(0, 12);
			const sortRaw = sp.get("sort");
			const dirRaw = sp.get("dir");
			const query = sp.get("query") ?? undefined;
			const asFreelancerRaw = sp.get("asFreelancer");
			const asFreelancer = asFreelancerRaw === null ? undefined : asFreelancerRaw === "1";
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

			return ProjectBackendService.submissions({
				projectId,
				channelId: channelId || null,
				path: path.length > 0 ? path : undefined,
				sort,
				dir,
				kinds: kinds.length > 0 ? kinds : undefined,
				query: query || undefined,
				asFreelancer,
				cursor: cursor || null,
				limit: Number.isFinite(limit) ? limit : undefined,
			}, readActor(ctx));
		},
		toBody: toProjectsBody,
	}),
);
