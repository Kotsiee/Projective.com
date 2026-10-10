import type { InspectAsset } from "@projective/types/files";
import { FilesService } from "@features/files/core/FilesService.ts";

/**
 * Hand the original over as an attachment. A signed-in viewer's copy is recorded first, exactly as
 * the files hub does; the proxy itself never counts. A failed record never blocks the download.
 */
export async function downloadAsset(asset: InspectAsset, signedIn: boolean): Promise<void> {
	if (signedIn) {
		await FilesService.recordDownload({
			assetId: asset.id,
			via: asset.access === "share" ? "share" : "preview",
			shareSlug: asset.access === "share" ? asset.share : null,
		});
	}
	globalThis.location.assign(asset.downloadHref);
}
