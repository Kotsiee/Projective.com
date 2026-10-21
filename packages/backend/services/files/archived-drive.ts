import type { AssetListPage } from "@projective/types/files";

/**
 * archived-drive — how an archived team's or business's drive answers a read (Decisions #306 (h),
 * #315): every row stays readable and none is offered for management, the way a mounted location is.
 * The database refuses the writes themselves (#314); this keeps the hub from offering them.
 */

/** The page an archived entity's drive answers: read-only, every asset and folder unmanaged. */
export function sealArchivedPage(page: AssetListPage): AssetListPage {
	return {
		...page,
		readOnly: true,
		items: page.items.map((item) => ({ ...item, canManage: false, shareSlug: null })),
		folders: page.folders.map((folder) => ({ ...folder, canManage: false, shareSlug: null })),
	};
}
