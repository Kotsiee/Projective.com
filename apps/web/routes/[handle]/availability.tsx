import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { resolveAvailabilityPage } from "@web/features/calendar/core/calendar-ssr.ts";
import { viewerFromState } from "@web/features/calendar/core/viewer.ts";
import ScheduleView from "@web/features/calendar/islands/ScheduleView.island.tsx";

/**
 * `/[handle]/availability` — the Availability page: the `@handle`'s real booking calendar (weekly working
 * hours, timezone, blackout dates, privacy-masked bookable/busy blocks, and public group sessions),
 * rendered by the reusable `@projective/ui/calendar` engine. A static sibling of `[tab].tsx`, so it wins
 * over the dynamic tab segment. Resolves the schedule server-side (the fat
 * {@link ScheduleBackendService.availability}, no HTTP hop) and hands it to the {@link ScheduleView} island;
 * the profile chrome (header · tabs) comes from the shared `[handle]/_layout.tsx`.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const profile = ctx.state.profile;
		ctx.state.title = profile
			? `Availability · ${profile.name} · Projective`
			: "Availability · Projective";
		// Read live in the handler: the schedule comes from Postgres, and a page component cannot await.
		const { page: schedule } = profile
			? await resolveAvailabilityPage(profile.handle, viewerFromState(ctx.state))
			: { page: null };
		return page({ schedule });
	},
});

export default define.page<typeof handler>(function ProfileAvailabilityPage(ctx) {
	const profile = ctx.state.profile;
	if (!profile) return null;
	return <ScheduleView scope="availability" handle={profile.handle} initial={ctx.data.schedule} fullPage />;
});
