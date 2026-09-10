import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import type { ProfileTabPayload } from "@projective/types/profile";
import { resolveProfileTab } from "@features/profile/core/profile-ssr.ts";
import { ProfileTabContent } from "@features/profile/components/ProfileTabContent.tsx";
import { isOwnProfile } from "@features/profile/core/profile-model.ts";

/**
 * `/[handle]` — the profile index, which IS the Work section (root CLAUDE.md §8 Decision #96). The
 * hero, the context bar and the tab bar are layout chrome (rendered by `[handle]/_layout.tsx`); this
 * route supplies the Work body below them: the client-proof strip, services, completed projects, the
 * portfolio masonry and — for a multi-member entity — the roster. `/[handle]/work` canonicalises here
 * (a 308 in `[tab].tsx`) so one section has one address. The profile is resolved by
 * `[handle]/_middleware.ts` onto `ctx.state.profile`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const profile = ctx.state.profile;
		ctx.state.title = profile
			? `${profile.name} (${profile.handle}) · Projective`
			: "Profile · Projective";
		if (profile) ctx.state.description = profile.headline;
		const payload = profile ? resolveProfileTab(profile.handle, "work") : null;
		return page({ payload });
	},
});

export default define.page<typeof handler>(function ProfileHomePage(ctx) {
	const profile = ctx.state.profile;
	const { payload } = ctx.data as { payload: ProfileTabPayload | null };
	if (!profile || !payload) return null; // the layout renders the not-found chrome
	return (
		<ProfileTabContent
			profile={profile}
			tab="work"
			payload={payload}
			canEdit={isOwnProfile(profile, ctx.state.userContext)}
			authed={!!ctx.state.isAuthenticated}
		/>
	);
});
