import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { ProfileTab, type ProfileTabPayload } from "@projective/types/profile";
import { resolveProfileTab } from "@features/profile/core/profile-ssr.ts";
import { ProfileTabContent } from "@features/profile/components/ProfileTabContent.tsx";
import { isOwnProfile, TAB_LABEL, tabsFor } from "@features/profile/core/profile-model.ts";

/**
 * `/[handle]/[tab]` — the single dynamic route that serves EVERY entity-conditional profile tab
 * (services · products · projects · portfolio · education · experience · teams · businesses · articles
 * · reviews · members). It validates the segment against the profile's own kind matrix (so a client
 * can't open a freelancer-only tab) and SSR-resolves the tab payload from the fat service. Static
 * sibling routes (`availability`, `view/[item]`, `index`) win over this dynamic segment in Fresh.
 */
export const handler = define.handlers({
	GET(ctx) {
		const profile = ctx.state.profile;
		// `about` is the index (`/[handle]`), never a `/[handle]/about` sub-route — canonicalise it so
		// the explicit segment doesn't render an off-matrix body inside the Overview chrome.
		if (ctx.params.tab === "about") {
			const handle = profile?.handle ?? ctx.params.handle;
			return new Response(null, { status: 308, headers: { location: `/${handle}` } });
		}
		const parsed = ProfileTab.safeParse(ctx.params.tab);
		const tab = parsed.success ? parsed.data : null;
		const valid = !!profile && !!tab && tab !== "about" && tabsFor(profile.kind).includes(tab);
		if (!profile || !valid || !tab) {
			// A missing profile is a not-found handle (the layout paints "Profile not found"); a valid
			// profile with an off-matrix tab is a missing section — keep the <title> honest to each.
			ctx.state.title = profile ? "Section not found · Projective" : "Profile not found · Projective";
			return page({ tab: null, payload: null });
		}
		const payload = resolveProfileTab(profile.handle, tab);
		ctx.state.title = `${TAB_LABEL[tab]} · ${profile.name} · Projective`;
		return page({ tab, payload });
	},
});

export default define.page<typeof handler>(function ProfileTabPage(ctx) {
	const profile = ctx.state.profile;
	const { tab, payload } = ctx.data as { tab: ProfileTab | null; payload: ProfileTabPayload | null };
	if (!profile || !tab || !payload) {
		return <p class="pf-empty">This section isn’t available for this profile.</p>;
	}
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
