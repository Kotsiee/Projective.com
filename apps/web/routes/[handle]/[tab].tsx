import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { ProfileTab, type ProfileTabPayload } from "@projective/types/profile";
import { resolveProfileTab } from "@features/profile/core/profile-ssr.ts";
import { ProfileTabContent } from "@features/profile/components/ProfileTabContent.tsx";
import {
	isOwnProfile,
	legacyTabTarget,
	TAB_LABEL,
	tabHref,
	tabsFor,
} from "@features/profile/core/profile-model.ts";

/**
 * `/[handle]/[tab]` — the single dynamic route that serves the three non-index profile sections
 * (`experience` · `reviews` · `posts`; Work is the index). It validates the segment against the
 * profile's kind matrix (a team has no Experience) and SSR-resolves the section payload from the fat
 * service. Static sibling routes (`availability`, `view/[item]`, `index`) win over this dynamic
 * segment in Fresh.
 *
 * **Legacy addresses redirect, they do not 404.** The eleven retired tab segments (`services`,
 * `portfolio`, `projects`, `products`, `education`, `articles`, `teams`, `businesses`, `members`,
 * `departments`, `about`) and the non-canonical `work` all answer **308** into their consolidated
 * section (root CLAUDE.md §8 Decision #96), so a bookmark or a link in a message keeps working. 308
 * rather than 301 because the method is preserved and the mapping is permanent; nothing POSTs here.
 */
export const handler = define.handlers({
	GET(ctx) {
		const profile = ctx.state.profile;
		const segment = ctx.params.tab;

		const legacy = legacyTabTarget(segment);
		if (legacy && !ProfileTab.safeParse(segment).success) {
			const handle = profile?.handle ?? ctx.params.handle;
			return new Response(null, {
				status: 308,
				headers: { location: tabHref(handle, legacy) },
			});
		}
		// `work` is a real section but its address is the bare index — canonicalise it.
		if (segment === "work") {
			const handle = profile?.handle ?? ctx.params.handle;
			return new Response(null, { status: 308, headers: { location: `/${handle}` } });
		}

		const parsed = ProfileTab.safeParse(segment);
		const tab = parsed.success ? parsed.data : null;
		const valid = !!profile && !!tab && tabsFor(profile.kind).includes(tab);
		if (!profile || !valid || !tab) {
			// A missing profile is a not-found handle (the layout paints "Profile not found"); a valid
			// profile with an off-matrix section is a missing section — keep the <title> honest to each.
			ctx.state.title = profile ? "Section not found · Projective" : "Profile not found · Projective";
			// The middleware already stamps 404 on a missing profile; an off-matrix section on a real
			// profile is a missing page too, and must not answer 200 with a "not found" body.
			return page({ tab: null, payload: null }, { status: 404 });
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
		return <p class="pf-empty__note">This section isn’t available for this profile.</p>;
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
