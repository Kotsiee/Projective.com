import { getProfile } from "./api.ts";
import type { ProfileTab, ProfileTabPayload, ProfileView } from "@projective/types/profile";
import type { ProfileResult } from "../types/results.ts";

/**
 * ProfileService — the THIN client profile service.
 *
 * A dumb object of named methods; each builds a path and forwards to a `/api/profile/*` route,
 * returning a soft {@link ProfileResult}. No fixtures, no query logic, no scattered `fetch` — islands
 * call these for client-side refinement (a tab preview, a header refresh) while the fat
 * {@link ProfileBackendService} owns all resolution (mirrors ExploreService / AuthService). First
 * paint is SSR-hydrated via props; these exist for the thin-frontend contract + the live path.
 */
export const ProfileService = {
	/** The profile header/overview projection for a `@handle`. */
	overview(handle: string): Promise<ProfileResult<{ profile: ProfileView }>> {
		return getProfile<{ profile: ProfileView }>(`/api/profile/${encodeURIComponent(handle)}`);
	},

	/** One tab's payload (item grid / structured entries) for a `@handle`. */
	tab(handle: string, tab: ProfileTab): Promise<ProfileResult<{ payload: ProfileTabPayload }>> {
		return getProfile<{ payload: ProfileTabPayload }>(
			`/api/profile/${encodeURIComponent(handle)}?tab=${encodeURIComponent(tab)}`,
		);
	},
};
