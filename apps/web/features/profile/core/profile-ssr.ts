import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";
import type { ProfileTab, ProfileTabPayload, ProfileView } from "@projective/types/profile";

/**
 * profile-ssr — the SERVER-ONLY bootstrap the `[handle]` middleware + sub-routes use to paint the
 * profile's first byte straight from the fat {@link ProfileBackendService} (no HTTP hop — exactly as
 * the projects feed / detail SSR their first paint). Never imported by an island (it reaches
 * `@server/services`); islands refine via the thin `ProfileService`.
 */

/** Resolve the profile header/overview projection for a `@handle`, or `null` (reserved/unresolved). */
export function resolveProfile(handle: string): ProfileView | null {
	const res = ProfileBackendService.overview(handle);
	return res.ok && res.data ? res.data.profile : null;
}

/** Resolve one profile tab's payload for SSR, or `null` when the handle didn't resolve. */
export function resolveProfileTab(handle: string, tab: ProfileTab): ProfileTabPayload | null {
	const res = ProfileBackendService.tab(handle, tab);
	return res.ok && res.data ? res.data.payload : null;
}
