import { driveAddressOf, linksWouldStop } from "@projective/types/files";
import { linkHref } from "@web/features/projects/components/preview/preview-model.ts";
import {
	type AssetItem,
	type AssetVisibility,
	fileInspectHref,
	inspectable,
	shareHref,
} from "../types/file-types.ts";
import { FilesService } from "./FilesService.ts";
import { rememberFolderColor } from "./folder-colors.ts";
import { IntegrationsService } from "./IntegrationsService.ts";
import { type DragPayload, isIdleDrop } from "./files-dnd.ts";
import {
	applyError,
	busy,
	clipboard,
	commitFiles,
	crumbs,
	currentPath,
	folders,
	goTo,
	goToHref,
	inspectId,
	type PendingRemoval,
	pendingTierDrop,
	tierDropOpen,
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

/**
 * Where a Share row points: the file's live share link, else its inspector page (which opens for
 * whoever may already read it), else a link's or drive file's own address.
 */
export function shareHrefOf(asset: AssetItem): string {
	if (asset.shareSlug) return shareHref(asset.shareSlug);
	return inspectable(asset) ? fileInspectHref(asset.id) : linkHref(asset) ?? asset.url;
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

/** Move rows into a folder; `null` is their library's root. Says whether they moved. */
export async function moveRows(payload: DragPayload, targetFolderId: string | null): Promise<boolean> {
	if (payload.assetIds.length + payload.folderIds.length === 0) return false;
	const moved = await write(
		() => FilesService.move({ ...payload, targetFolderId }),
		"Those could not be moved.",
	);
	if (moved) commitFiles();
	return moved;
}

/**
 * Paste what the clipboard holds into a folder. A cut moves and empties the clipboard, or keeps it so
 * a refused paste can be tried elsewhere; a copy leaves it, so it can land again. A cut pasted where
 * it came from changes nothing, and that still ends the cut.
 */
export async function pasteRows(targetFolderId: string | null): Promise<void> {
	const held = clipboard.value;
	if (!held) return;
	const rows = { assetIds: held.assetIds, folderIds: held.folderIds };
	if (held.mode === "cut") {
		if (isIdleDrop(rows, targetFolderId, held.from) || await moveRows(rows, targetFolderId)) {
			clipboard.value = null;
		}
		return;
	}
	const copied = await write(
		() => FilesService.copy({ ...rows, targetFolderId }),
		"Those could not be copied.",
	);
	if (copied) commitFiles();
}

/** Rename a folder. The card changes at once; a refusal re-reads, so the server's name stays. */
export async function renameFolder(folderId: string, name: string): Promise<void> {
	folders.value = folders.value.map((f) => (f.id === folderId ? { ...f, name } : f));
	const renamed = await write(
		() => FilesService.renameFolder({ folderId, name }),
		"That folder could not be renamed.",
	);
	if (!renamed) commitFiles();
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

/**
 * Change an asset's privacy scope. A drop below Anyone with the link that would stop live share links
 * is held for the owner's confirm (Decision #570), then sent again with `stopLinks`.
 */
export async function setVisibility(
	asset: AssetItem,
	visibility: AssetVisibility,
	stopLinks = false,
): Promise<void> {
	let held: number | null = null;
	const res = await write(async () => {
		const sent = await FilesService.setVisibility({
			assetIds: [asset.id],
			folderIds: [],
			visibility,
			stopLinks,
		});
		held = sent.ok ? null : linksWouldStop(sent.details);
		return held === null ? sent : { ok: true };
	}, "That privacy change could not be applied.");
	if (held !== null) {
		pendingTierDrop.value = { asset, visibility, links: held };
		tierDropOpen.value = true;
		return;
	}
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

/**
 * Add a drive file to the acting library's root as a reference: nothing is copied, and the library's
 * allowance does not move. Says whether it landed.
 */
export async function addToLibrary(asset: AssetItem): Promise<boolean> {
	const ref = asset.external;
	if (!ref) return false;
	return await write(
		() =>
			IntegrationsService.importAsset({
				connectionId: ref.connectionId,
				externalFileId: ref.externalFileId,
				folderId: null,
			}),
		"That file could not be added.",
	);
}

/** Disconnect a drive. Standing inside it, the address steps out to the library. */
export async function disconnectDrive(connectionId: string): Promise<void> {
	const closed = await write(
		() => IntegrationsService.revoke({ connectionId }),
		"That drive could not be disconnected.",
	);
	if (closed && driveAddressOf(currentPath.value)?.connectionId === connectionId) goTo([]);
}
