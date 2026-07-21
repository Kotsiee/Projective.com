import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { ProfileTab, type ProfileTabPayload } from "@projective/types/profile";
import { resolveProfileTab } from "@features/profile/core/profile-ssr.ts";
import { ProfileTabContent } from "@features/profile/components/ProfileTabContent.tsx";
import { defaultTabFor, isOwnProfile } from "@features/profile/core/profile-model.ts";

/**
 * `/[handle]` — the profile index. The permanent Overview + the tab bar are layout chrome (rendered by
 * `[handle]/_layout.tsx`); THIS route supplies the body of the **default open tab** below them (root
 * CLAUDE.md — Part 1.1: default to Services, or the kind's first tab). It mirrors `[handle]/[tab].tsx`
 * for that one default tab so the index and an explicit `/[handle]/services` render the same body. The
 * profile is resolved by `[handle]/_middleware.ts` onto `ctx.state.profile`.
 */
export const handler = define.handlers({
	GET(ctx) {
		const profile = ctx.state.profile;
		ctx.state.title = profile
			? `${profile.name} (${profile.handle}) · Projective`
			: "Profile · Projective";
		if (profile) ctx.state.description = profile.headline;
		const tab: ProfileTab | null = profile ? defaultTabFor(profile.kind) : null;
		const payload = profile && tab ? resolveProfileTab(profile.handle, tab) : null;
		return page({ tab, payload });
	},
});

export default define.page<typeof handler>(function ProfileHomePage(ctx) {
	const profile = ctx.state.profile;
	const { tab, payload } = ctx.data as { tab: ProfileTab | null; payload: ProfileTabPayload | null };
	if (!profile || !tab || !payload) return null; // the layout renders the not-found / Overview chrome
	return (
		<ProfileTabContent
			profile={profile}
			tab={tab}
			payload={payload}
			canEdit={isOwnProfile(profile, ctx.state.userContext)}
			authed={!!ctx.state.isAuthenticated}
		/>
	);
});
