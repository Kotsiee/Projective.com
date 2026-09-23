import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import type { OwnerAvailability } from "@projective/types/scheduling";
import { resolveOwnerAvailability } from "@features/profile/core/profile-ssr.ts";
import AvailabilityEditor from "@features/profile/islands/AvailabilityEditor.island.tsx";

/**
 * `/[handle]/edit/availability` — the owner's **Availability** page: working hours and the
 * discovery-call offer. Owner-only with the same server guard as `/[handle]/edit` — a guest is sent
 * to sign in, anyone else to the profile — and seeded from the owner's own schedule (a draft
 * included), read under their session.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const profile = ctx.state.profile;
		if (!profile) return page({ availability: null, takesCalls: false });
		const self = `/${profile.handle}/edit/availability`;
		if (!ctx.state.accessToken && !ctx.state.isAuthenticated) {
			return new Response(null, {
				status: 303,
				headers: { location: `/login?redirectTo=${encodeURIComponent(self)}` },
			});
		}
		if (!profile.viewer?.isOwner) {
			return new Response(null, { status: 303, headers: { location: `/${profile.handle}` } });
		}
		const { availability, takesCalls, status } = await resolveOwnerAvailability(profile.handle, readActor(ctx));
		if (!availability) {
			if (status === 401) {
				return new Response(null, {
					status: 303,
					headers: { location: `/login?redirectTo=${encodeURIComponent(self)}` },
				});
			}
			if (status === 403) {
				return new Response(null, { status: 303, headers: { location: `/${profile.handle}` } });
			}
			return page({ availability: null, takesCalls }, { status: 503 });
		}
		ctx.state.title = `Availability · ${profile.name} · Projective`;
		return page({ availability, takesCalls });
	},
});

export default define.page<typeof handler>(function ProfileAvailabilityEditPage(ctx) {
	const { availability, takesCalls } = ctx.data as {
		availability: OwnerAvailability | null;
		takesCalls: boolean;
	};
	const profile = ctx.state.profile;
	if (!profile) return null;
	if (!availability) {
		return (
			<p class="pf-empty__note" role="alert">
				Your availability can't be loaded right now. Try again in a moment.
			</p>
		);
	}
	return <AvailabilityEditor handle={profile.handle} initial={availability} takesCalls={takesCalls} />;
});
