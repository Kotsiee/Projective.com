import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import type {
	AssetListPage,
	AssetListParams,
	AssetTreeNode,
	ShareResolution,
} from "../types/file-types.ts";

/**
 * files-ssr — the server-only bootstraps for the `/files` surface's first paint.
 *
 * They call the fat {@link FilesBackendService} DIRECTLY (no HTTP hop), as the signed-in person, so
 * the body ships its first location resolved in the initial byte; the islands then refine through the
 * thin `FilesService`. **Never imported by an island** — the import edge is what keeps the
 * Supabase-touching half out of the client bundle.
 *
 * A read that FAILED is reported as a failure (`error`) beside a complete, read-only empty page —
 * never as an empty library alone, which would be a false claim about someone's files.
 *
 * **Nothing here writes `files-state`.** Those signals are module-level and therefore per-PROCESS on
 * the server; a write during SSR would leak one request's library into the next person's first paint.
 * These functions return values, the route passes them as PROPS, and the body seeds the signals on
 * mount in the browser.
 */

// #region Listing
/** Everything the body + the header band need to paint a location without a client round-trip. */
export interface FilesBootstrap {
	page: AssetListPage;
	/** The navigation tree for the lane — a separate read, because it spans every scope. */
	tree: AssetTreeNode[];
	/** Why the location could not be read, or `null`. */
	error: string | null;
	/** The HTTP status the page answers with: 200, 404 for a folder that is not there, else the failure's. */
	status: number;
}

/** A complete, renderable empty page for a location that could not be read. */
function emptyPage(params: AssetListParams): AssetListPage {
	return {
		scope: params.scope,
		subjectId: params.subjectId ?? null,
		folderId: params.folderId ?? null,
		items: [],
		folders: [],
		crumbs: [],
		hasMore: false,
		nextCursor: null,
		total: 0,
		viewerId: "",
		// A location that failed to resolve is treated as read-only: offering an upload target into a
		// place the server could not describe is how a person loses a file to a folder that is not there.
		readOnly: true,
		quota: null,
	};
}

/**
 * Resolve the page AND the tree for a first paint. Issued together: they are independent, and
 * awaiting the tree behind the page would add its latency to every navigation.
 */
export async function resolveFilesBootstrap(
	params: AssetListParams,
	actor: ReadActor,
): Promise<FilesBootstrap> {
	const [page, tree] = await Promise.all([
		FilesBackendService.list(params, actor),
		FilesBackendService.tree(actor),
	]);
	return {
		page: page.ok && page.data ? page.data : emptyPage(params),
		tree: tree.ok && tree.data ? tree.data : [],
		error: page.ok ? null : page.status === 404
			? "That folder doesn't exist — it may have been moved or deleted."
			: page.message ?? "Your files couldn't be loaded just now.",
		status: page.ok ? 200 : page.status ?? 503,
	};
}
// #endregion

// #region Share resolution
/**
 * Resolve a share slug for the public `/share/[slug]` route.
 *
 * **Every failure state is collapsed to `not_found` here, before it can reach a template.** Telling an
 * anonymous caller that a link expired rather than that there is no such link confirms a link
 * existed, which is the single bit an enumeration attack is probing for.
 */
export async function resolveShare(slug: string): Promise<ShareResolution> {
	const res = await FilesBackendService.resolveShare(slug);
	if (!res.ok || !res.data) return { state: "not_found" };
	return res.data.state === "ok" ? res.data : { state: "not_found" };
}
// #endregion
