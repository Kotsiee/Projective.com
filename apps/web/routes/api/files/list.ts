import { define } from "@web/utils/state.ts";
import { AssetListParamsSchema, simFromParams } from "@projective/types/files";
import { toFilesResponse } from "@features/files/core/respond.ts";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import type {
	AssetListParams,
	AssetSource,
	AssetVisibility,
	FileKind,
	FileScope,
	FileSortDir,
	FileSortKey,
} from "@projective/types/files";

/**
 * `GET /api/files/list?scope=&subjectId=&channelId=&folderId=&path=&sort=&dir=&kinds=&sources=
 * &visibility=&query=&cursor=&limit=` — the thin route for one scope read.
 *
 * Parses the query against literal allow-lists, re-validates the whole shape through the Zod SSOT
 * ({@link AssetListParamsSchema}), reads the developer simulation overlay from its own `sim*` params
 * ({@link simFromParams}), then delegates to the fat {@link FilesBackendService.list} — which answers
 * with the assets, the child folders, the breadcrumb trail, the location's `readOnly` fact and (on a
 * `hub` read) the owner's allowance in one payload. Islands never reach the backend; they fetch this
 * through the dumb `FilesService`.
 *
 * **No server-side capability guard, and — stated plainly — no other gate in front of this read
 * today.** The Dev Context Switcher is a CLIENT seam the server cannot see, so a capability bounce
 * here would make every dev axis inert (Decision #53(b)). That is a deliberate choice about
 * CAPABILITY. It is not a claim that something else is guarding the route, and the two are worth
 * keeping apart:
 *
 * * `/api/files/*` is NOT inside the `(dashboard)` route group, so that group's guest bounce
 *   (`routes/(dashboard)/_middleware.ts`) never runs for it. The only middleware in the path is the
 *   global one, which hydrates `ctx.state.userContext` and bounces nobody.
 * * With `FILES_BACKEND_LIVE` off there is no RLS either, because nothing here reaches Postgres — the
 *   deterministic fixtures answer every caller identically, signed in or not.
 *
 * So the honest statement is: **this read is currently open, and it exposes a fixture corpus rather
 * than anybody's data.** RLS under the caller's JWT becomes the real gate when the gate flips, and it
 * is the ONLY thing that will bound a scope read — which is why the fat service's live branch is
 * written as a query under the caller's token rather than a service-role one. The routes that carry
 * IDENTITY rather than a filter (`./download-guard.ts`, `./download-record.ts`, and every mutation)
 * already read the session today and never accept an actor or an owner from the request.
 *
 * An unrecognised filter value is DROPPED rather than failing the read: a stale bookmark carrying a
 * retired kind should show the library, not an error page. Only a malformed scope — the one param the
 * read cannot proceed without — is refused.
 */

// #region Allow-lists
const SCOPES: readonly FileScope[] = [
	"channel",
	"project",
	"conversation",
	"hub",
	"drive",
	"share",
];
const SORT_KEYS: readonly FileSortKey[] = ["name", "date", "size", "sender", "type"];
const KINDS: readonly FileKind[] = [
	"image",
	"video",
	"audio",
	"pdf",
	"doc",
	"code",
	"archive",
	"link",
	"file",
];
const SOURCES: readonly AssetSource[] = [
	"supabase",
	"google_drive",
	"dropbox",
	"frameio",
	"s3",
	"link",
];
const VISIBILITIES: readonly AssetVisibility[] = ["private", "link", "public"];
// #endregion

// #region Parsing
/** Split a comma-separated filter, keeping only recognised members; `undefined` when nothing survives. */
function members<T extends string>(raw: string | null, allowed: readonly T[]): T[] | undefined {
	if (!raw) return undefined;
	const kept = raw
		.split(",")
		.map((value) => value.trim())
		.filter((value): value is T => (allowed as readonly string[]).includes(value));
	return kept.length > 0 ? kept : undefined;
}

/**
 * Decode the deep-link path (`/files/a/b/c`) back into its segments.
 *
 * Each segment was encoded INDEPENDENTLY by the client, so a folder literally named `a/b` cannot be
 * read back as the nested pair `["a", "b"]` — the same reason the SSOT's `pathKey` encodes before it
 * joins. A segment that will not decode is kept verbatim rather than throwing: a malformed crumb
 * should resolve to "no such folder", not to a 500.
 */
function segments(raw: string | null): string[] | undefined {
	if (!raw) return undefined;
	const parts = raw.split("/").filter((part) => part.length > 0).map((part) => {
		try {
			return decodeURIComponent(part);
		} catch {
			return part;
		}
	});
	return parts.length > 0 ? parts : undefined;
}
// #endregion

export const handler = define.handlers({
	async GET(ctx) {
		const sp = ctx.url.searchParams;
		const scopeRaw = sp.get("scope");
		if (!scopeRaw || !SCOPES.includes(scopeRaw as FileScope)) {
			return Response.json({ ok: false, message: "Missing or unknown scope." }, { status: 400 });
		}

		const sortRaw = sp.get("sort");
		const dirRaw = sp.get("dir");
		const limitRaw = sp.get("limit");
		const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

		const candidate: AssetListParams = {
			scope: scopeRaw as FileScope,
			subjectId: sp.get("subjectId") || undefined,
			channelId: sp.get("channelId") || undefined,
			folderId: sp.get("folderId") || undefined,
			path: segments(sp.get("path")),
			sort: sortRaw && SORT_KEYS.includes(sortRaw as FileSortKey)
				? (sortRaw as FileSortKey)
				: undefined,
			dir: dirRaw === "asc" || dirRaw === "desc" ? (dirRaw as FileSortDir) : undefined,
			kinds: members(sp.get("kinds"), KINDS),
			sources: members(sp.get("sources"), SOURCES),
			visibility: members(sp.get("visibility"), VISIBILITIES),
			query: sp.get("query") || undefined,
			cursor: sp.get("cursor") || null,
			limit: Number.isFinite(limit) ? limit : undefined,
		};

		const parsed = AssetListParamsSchema.safeParse(candidate);
		if (!parsed.success) {
			return Response.json({ ok: false, message: "That file query is not valid." }, {
				status: 400,
			});
		}

		return toFilesResponse(await FilesBackendService.list(parsed.data, simFromParams(sp)));
	},
});
