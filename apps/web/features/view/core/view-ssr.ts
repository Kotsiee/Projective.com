import { ExploreBackendService } from "@server/services/explore/ExploreBackendService.ts";
import type { EntityView } from "@projective/types/explore";

/**
 * View feature — the SSR resolver bridging the route/layout to the fat {@link ExploreBackendService}.
 * A single in-process call (no HTTP hop) so the standalone page AND its sidebar action lane resolve
 * the same composed {@link EntityView} on the first byte. Mirrors the other feature SSR resolvers
 * (`resolveProfile` / `resolveFilePage`).
 */
export function resolveViewPage(id: string): { view: EntityView | undefined } {
	const result = ExploreBackendService.viewPage(id);
	return { view: result.ok ? result.data : undefined };
}
