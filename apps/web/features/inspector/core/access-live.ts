import { signal } from "@preact/signals";
import type { AssetVisibility, InspectAsset } from "@projective/types/files";

/**
 * access-live — the file's reach as the page last learned it (Decision #402). The inspector's asset is
 * fixed for the page's life, so a save in the Access tab writes here, and the bar's Share, the Details
 * row and the share modal read the file's tier and share link from here rather than from the asset.
 */

/** The file's tier and live share link path. */
export interface LiveReach {
	visibility: AssetVisibility;
	shareUrl: string | null;
}

/** The saved reach once the Access tab has read or written it; `null` until then. */
export const liveReach = signal<LiveReach | null>(null);

/** The reach to show: the latest saved one, else the page's first paint. */
export function reachOf(asset: Pick<InspectAsset, "visibility" | "shareUrl">): LiveReach {
	return liveReach.value ?? { visibility: asset.visibility, shareUrl: asset.shareUrl };
}

/** Whether a link to the file opens for anyone it is passed to: a public file, or a live share link. */
export function opensForAnyone(reach: LiveReach): boolean {
	return reach.visibility === "public" || (reach.visibility === "link" && reach.shareUrl !== null);
}
