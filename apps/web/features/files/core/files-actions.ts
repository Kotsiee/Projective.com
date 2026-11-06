import { driveAddressOf } from "@projective/types/files";
import { linkHref } from "@web/features/projects/components/preview/preview-model.ts";
import {
	type AssetItem,
	type AssetVisibility,
	fileInspectHref,
	inspectable,
} from "../types/file-types.ts";
import { FilesService } from "./FilesService.ts";
import { rememberFolderColor } from "./folder-colors.ts";
import { IntegrationsService } from "./IntegrationsService.ts";
import type { DragPayload } from "./files-dnd.ts";
import {
	applyError,
	busy,
	commitFiles,
	crumbs,
	currentPath,
	folders,
	goTo,
	goToHref,
	inspectId,
	type PendingRemoval,
	treeRevision,
} from "./files-state.ts";

/**
 * files-actions — the writes any region of the hub can raise. The lane's menus, the body's menus and
 * drops, the inspector and the footer rig's confirmations are separate hydration roots, so what they
 * share lives here: each write goes through the thin services, reports a failure beside the data with
 * `applyError` and asks the body to re-read, which keeps the body the single fetch owner.
 */

/** Open an asset in a new tab: a stored file in the inspector, a link or drive file at its own address. */
export function openInNewTab(asset: AssetItem): void {
	const target = inspectable(asset) ? fileInspectHref(asset.id) : linkHref(asset) ?? asset.url;
	if (!target || target === "#") return;
	globalThis.open(target, "_blank", "noopener,noreferrer");
}

/** Download: record the copy, then hand the bytes over. A drive file has no row for the ledger to hold. */
export async function download(asset: AssetItem): Promise<void> {
	const target = linkHref(asset) ?? asset.url;
	if (!target || target === "#") return;
	if (asset.external === null) await FilesService.recordDownload({ assetId: asset.id, via: "hub" });
	globalThis.open(target, "_blank", "noopener,noreferrer");
}

/** Run one write over listed rows, then re-read. The structure may have changed, so the tree re-reads too. */
async function write(
	run: () => Promise<{ ok: boolean; message?: string }>,
	failure: string,
): Promise<boolean> {
	busy.value = true;
	const res = await run();
	busy.value = false;
	if (!res.ok) {
		applyError(res.message ?? failure);
		return false;
	}
	treeRevision.value += 1;
	return true;
}

/** Move rows into a folder; `null` is their library's root. */
export async function moveRows(payload: DragPayload, targetFolderId: string | null): Promise<void> {
	if (payload.assetIds.length + payload.folderIds.length === 0) return;
	const moved = await write(
		() => FilesService.move({ ...payload, targetFolderId }),
		"Those could not be moved.",
	);
	if (moved) commitFiles();
}

/**
 * Colour a folder, or clear it with `null`. The card changes at once and the tree follows its re-read;
 * a refusal re-reads the listing, so the server's colour is what stays.
 */
export async function paintFolder(folderId: string, color: string | null): Promise<void> {
	folders.value = folders.value.map((f) => (f.id === folderId ? { ...f, color } : f));
	if (color) rememberFolderColor(color);
	const saved = await write(
		() => FilesService.setFolderColor({ folderId, color }),
		"That colour could not be saved.",
	);
	if (!saved) commitFiles();
}

/** Change an asset's privacy scope. */
export async function setVisibility(asset: AssetItem, visibility: AssetVisibility): Promise<void> {
	const res = await write(
		() => FilesService.setVisibility({ assetIds: [asset.id], folderIds: [], visibility }),
		"That privacy change could not be applied.",
	);
	if (res) commitFiles();
}

/**
 * Soft-delete rows. A folder the person is standing in, or under, has gone with them, so the address
 * steps out to what is left rather than reading a location that no longer exists.
 */
export async function removeRows({ assetIds, folderIds }: PendingRemoval): Promise<void> {
	const removed = await write(
		() => FilesService.remove({ assetIds, folderIds }),
		"That could not be deleted.",
	);
	if (!removed) return;
	if (inspectId.value && assetIds.includes(inspectId.value)) inspectId.value = null;
	const at = crumbs.value.findIndex((crumb) => crumb.id !== null && folderIds.includes(crumb.id));
	if (at > 0) goToHref(crumbs.value[at - 1].href);
	else commitFiles();
}

/** Disconnect a drive. Standing inside it, the address steps out to the library. */
export async function disconnectDrive(connectionId: string): Promise<void> {
	const closed = await write(
		() => IntegrationsService.revoke({ connectionId }),
		"That drive could not be disconnected.",
	);
	if (closed && driveAddressOf(currentPath.value)?.connectionId === connectionId) goTo([]);
}
