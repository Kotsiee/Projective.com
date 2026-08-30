import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { FileKind, FileListPage, FileSortDir, FileSortKey } from "@projective/types/projects";

/**
 * `/api/messaging/files` — the thin route for the conversation-scoped File Explorer read. HTTP parse +
 * light param guard, then delegate to the fat {@link MessagingBackendService.files} and map its
 * {@link ServiceResult} to a `Response`.
 *
 * It answers the SAME `FileListPage` contract as `/api/projects/files`, so the shared `FileExplorer`
 * island simply swaps its endpoint on `scope="conversation"` — one component, two data sources. The
 * Zod SSOT (`FileListParamsSchema`) is the shape contract; the route hand-validates the one required
 * param and coerces the rest, exactly as the sibling projects route does.
 *
 * `GET`, `HEAD` and `OPTIONS` all come from {@link defineReadRoute}, which resolves the payload ONCE
 * and derives the responses from it — so `HEAD` cannot drift from `GET`, and the `ETag` /
 * `If-None-Match` revalidation is identical on both. The missing-param guard answers from inside the
 * resolver, so `HEAD` reports the same `400` with the body stripped rather than leaking one.
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
			const sp = ctx.url.searchParams;
			const conversationId = sp.get("conversationId") ?? sp.get("projectId");
			if (!conversationId) {
				return Response.json({ ok: false, message: "Missing conversationId." }, { status: 400 });
			}

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

			return MessagingBackendService.files({
				projectId: conversationId,
				channelId: conversationId,
				sort,
				dir,
				kinds: kinds.length > 0 ? kinds : undefined,
				query: query || undefined,
				cursor: cursor || null,
				limit: Number.isFinite(limit) ? limit : undefined,
			}, readActor(ctx));
		},
		toBody: toMessagingBody,
	}),
);
