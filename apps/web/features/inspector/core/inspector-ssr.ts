import type { InspectAsset } from "@projective/types/files";
import { FilesBackendService } from "@server/services/files/FilesBackendService.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * inspector-ssr — the server-only read behind `/inspect/[fileId]`. Never imported by an island.
 *
 * Every refusal collapses to one `404`, so the page cannot say whether a file exists to someone who
 * may not read it; only a service failure answers `503`.
 */

/** The page's first paint: the asset, or nothing, and the status to answer with. */
export interface InspectResolution {
	asset: InspectAsset | null;
	status: 200 | 404 | 503;
}

const SHARE_SLUG_MAX = 128;

/** The `?share=` value as a slug candidate, or `null` when absent or implausible. */
export function shareParam(raw: string | null): string | null {
	const slug = raw?.trim() ?? "";
	return slug.length > 0 && slug.length <= SHARE_SLUG_MAX ? slug : null;
}

/** Resolve one file for the inspector as this viewer. */
export async function resolveInspect(
	fileId: string,
	share: string | null,
	actor: ReadActor,
): Promise<InspectResolution> {
	const result = await FilesBackendService.inspect(fileId, { share }, actor);
	if (result.ok && result.data) return { asset: result.data, status: 200 };
	return { asset: null, status: result.status === 503 ? 503 : 404 };
}
