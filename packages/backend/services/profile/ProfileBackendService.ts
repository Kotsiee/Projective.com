import { fail, ok, type ServiceResult } from "../ServiceResult.ts";
import { isProfileBackendLive } from "../../core/supabase.ts";
import { findProfile, findProfileTab } from "./profile-fixtures.ts";
import { isReservedHandle } from "@projective/types/profile";
import type { ProfileTab, ProfileTabPayload, ProfileView } from "@projective/types/profile";

/**
 * ProfileBackendService — the FAT server-side service behind the `/[handle]` public profile.
 *
 * It owns the profile header + overview projection and the entity-conditional tab reads. Thin routes
 * under `apps/web/routes/api/profile/*` do only HTTP parsing + Zod validation, then delegate here and
 * map the returned {@link ServiceResult} to a `Response`; the `[handle]` layout + sub-routes call these
 * directly for SSR first paint. Islands never reach this — they `fetch` the thin route via
 * `ProfileService`.
 *
 * **Reserved-handle guard.** A handle that collides with a top-level route segment (`explore`,
 * `settings`, `availability`, …) is rejected here with a 404 (root CLAUDE.md — the reserved-word
 * denylist safeguard), so the fixtures never fabricate a profile for a reserved word. See
 * {@link isReservedHandle}.
 *
 * **Stub mode (default).** With `PROFILE_BACKEND_LIVE` off (see {@link isProfileBackendLive}) the
 * service answers from deterministic fixtures derived from the discovery corpus — so a profile always
 * agrees with the explore card that linked to it. The live path (RLS-scoped `org.users_public` + the
 * profile tables) slots in behind the same gate with zero shape churn.
 */
export class ProfileBackendService {
	/**
	 * The public profile header + overview projection for a `@handle`: identity (banner/avatar/name),
	 * story/skills/languages/notable-clients, the dual-track reputation + verification tiers, and the
	 * per-tab counts that drive the entity tab matrix. `404` for a reserved handle or an unresolved one.
	 */
	static overview(handle: string): ServiceResult<{ profile: ProfileView }> {
		if (isReservedHandle(handle)) {
			return fail(404, { message: `"${handle}" is a reserved route, not a profile.` });
		}
		if (!isProfileBackendLive()) {
			const profile = findProfile(handle);
			if (!profile) return fail(404, { message: `No profile found for "${handle}".` });
			return ok({ profile });
		}
		// LIVE: read the RLS-scoped `org.users_public` + profile tables (not yet implemented) — fall back
		// to the fixture-backed projection so behaviour is preserved until that path lands.
		const profile = findProfile(handle);
		if (!profile) return fail(404, { message: `No profile found for "${handle}".` });
		return ok({ profile });
	}

	/**
	 * The payload for one profile tab (`/[handle]/<tab>`): the item grid (services · products ·
	 * portfolio · articles · teams · businesses via the shared explore cards), the split open/past
	 * projects, or the structured education/experience/members/reviews entries. `404` for a reserved or
	 * unresolved handle.
	 */
	static tab(handle: string, tab: ProfileTab): ServiceResult<{ payload: ProfileTabPayload }> {
		if (isReservedHandle(handle)) {
			return fail(404, { message: `"${handle}" is a reserved route, not a profile.` });
		}
		if (!isProfileBackendLive()) {
			const payload = findProfileTab(handle, tab);
			if (!payload) return fail(404, { message: `No profile found for "${handle}".` });
			return ok({ payload });
		}
		// LIVE: read the RLS-scoped profile tab tables (not yet implemented) — fall back to the fixture-
		// backed payload so behaviour is preserved until that path lands.
		const payload = findProfileTab(handle, tab);
		if (!payload) return fail(404, { message: `No profile found for "${handle}".` });
		return ok({ payload });
	}
}
