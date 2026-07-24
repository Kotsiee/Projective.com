import { define } from "@web/utils/state.ts";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import type { FileKind, FileSortDir, FileSortKey } from "@projective/types/projects";

/**
 * `/api/messaging/files` — the thin route for the conversation-scoped File Explorer read. HTTP parse +
 * light param guard, then delegate to the fat {@link MessagingBackendService.files} and map its
 * {@link ServiceResult} to a `Response`.
 *
 * It answers the SAME `FileListPage` contract as `/api/projects/files`, so the shared `FileExplorer`
 * island simply swaps its endpoint on `scope="conversation"` — one component, two data sources. The
 * Zod SSOT (`FileListParamsSchema`) is the shape contract; the route hand-validates the one required
 * param and coerces the rest, exactly as the sibling projects route does.
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

export const handler = define.handlers({
	GET(ctx) {
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

		return toMessagingResponse(
			MessagingBackendService.files({
				projectId: conversationId,
				channelId: conversationId,
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
