import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import type {
	AssetItem,
	AssetListPage,
	AssetListParams,
	AssetOwnerType,
	AssetTreeNode,
	FileScope,
	FilesSim,
	ShareResolution,
	StorageQuota,
} from "../types/file-types.ts";

/**
 * files-ssr — the server-only bootstraps for the `/files` surface's first paint.
 *
 * They call the fat {@link FilesBackendService} DIRECTLY (no HTTP hop), so the lane, the header band,
 * the body and the footer rig all ship resolved in the initial byte; the islands then refine through
 * the thin `FilesService`. Mirrors `resolveCataloguePage` / `resolveWalletOverview`. **Never imported
 * by an island** — the import edge is what keeps the Supabase-touching half out of the client bundle.
 *
 * Every resolver degrades to a coherent empty projection rather than throwing. A first paint that
 * 500s because a folder was renamed is a worse failure than a first paint that shows an empty library
 * and lets the island's refetch correct it — and the empty shapes below are real, complete values, so
 * nothing downstream has to null-check its way through a partial page.
 *
 * **Nothing here writes `files-state`.** Those signals are module-level and therefore per-PROCESS on
 * the server; a write during SSR would leak one request's library into the next person's first paint.
 * These functions return values, the route passes them as PROPS, and the body seeds the signals on
 * mount in the browser.
 *
 * The simulation overlay is threaded through because a developer arriving on a `sim*` URL should see
 * the simulated projection in the FIRST byte rather than after a client refetch — otherwise every
 * axis appears to flicker through the real data on the way to the one being exercised. The server
 * parses it from the query string (`simFromParams`), never from the client seam, which it cannot see.
 */

// #region Listing
/** Everything the body + the header band need to paint a location without a client round-trip. */
export interface FilesBootstrap {
	page: AssetListPage;
	/** The navigation tree for the lane — a separate read, because it spans every scope. */
	tree: AssetTreeNode[];
}

/** A complete, renderable empty page for a scope that resolved to nothing. */
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

/** Resolve one location's page (assets, folders, crumbs, `readOnly`, and the hub's allowance). */
export async function resolveFilesPage(
	params: AssetListParams,
	sim?: FilesSim,
): Promise<AssetListPage> {
	const res = await FilesBackendService.list(params, sim);
	return res.ok && res.data ? res.data : emptyPage(params);
}

/** Resolve the lane's navigation tree. */
export async function resolveFilesTree(params: {
	scope: FileScope;
	subjectId?: string | null;
	ownerType: AssetOwnerType;
	ownerId: string;
}): Promise<AssetTreeNode[]> {
	const res = await FilesBackendService.tree(params);
	return res.ok && res.data ? res.data : [];
}

/**
 * Resolve the page AND the tree for a first paint.
 *
 * Both reads are issued together rather than sequentially: they are independent, and awaiting the
 * tree behind the page would add its latency to every navigation for no ordering benefit.
 */
export async function resolveFilesBootstrap(
	params: AssetListParams,
	owner: { ownerType: AssetOwnerType; ownerId: string },
	sim?: FilesSim,
): Promise<FilesBootstrap> {
	const [page, tree] = await Promise.all([
		resolveFilesPage(params, sim),
		resolveFilesTree({
			scope: params.scope,
			subjectId: params.subjectId ?? null,
			ownerType: owner.ownerType,
			ownerId: owner.ownerId,
		}),
	]);
	return { page, tree };
}
// #endregion

// #region Single reads
/** Resolve one asset's row (a deep-linked preview), or `null`. */
export async function resolveAsset(id: string): Promise<AssetItem | null> {
	const res = await FilesBackendService.item(id);
	return res.ok && res.data ? res.data : null;
}

/** Resolve a principal's storage allowance for the meter's first paint, or `null` when unavailable. */
export async function resolveQuota(
	ownerType: AssetOwnerType,
	ownerId: string,
	sim?: FilesSim,
): Promise<StorageQuota | null> {
	const res = await FilesBackendService.quota({ ownerType, ownerId, sim });
	return res.ok && res.data ? res.data : null;
}
// #endregion

// #region Share resolution
/**
 * Resolve a share slug for the public `/share/[slug]` route.
 *
 * **Every failure state is collapsed to `not_found` here, before it can reach a template.** The
 * service distinguishes not-found from expired from revoked from exhausted so it can log and meter
 * them; telling an anonymous caller which one it was confirms that a slug existed, and that is the
 * single bit an enumeration attack is probing for. Collapsing at the SSR boundary — rather than
 * asking every template to remember — is what makes the leak unreachable rather than merely avoided.
 */
export async function resolveShare(
	slug: string,
	userRef?: string | null,
): Promise<ShareResolution> {
	const res = await FilesBackendService.resolveShare(slug, userRef ?? null);
	if (!res.ok || !res.data) return { state: "not_found" };
	return res.data.state === "ok" ? res.data : { state: "not_found" };
}
// #endregion
