import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { ProfileTab, type ProfileTabPayload, type ProfileView } from "@projective/types/profile";
import { toProfileBody } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `GET | HEAD | OPTIONS /api/profile/:handle` — the profile overview projection, or (with `?tab=`)
 * one section's payload, as the CALLER may see it: the fat {@link ProfileBackendService} reads it
 * under their own session, so a private profile answers 404 to anyone but its owner and the
 * `viewer` block reflects who is asking. HTTP parsing + the tab-enum guard only.
 *
 * The read is per-viewer, so it is `private` — the factory's default — and revalidated by `ETag`.
 */
const read = defineReadRoute<{ profile: ProfileView } | { payload: ProfileTabPayload }>({
	resolve: (ctx) => {
		const handle = ctx.params.handle;
		const tabParam = ctx.url.searchParams.get("tab");
		if (tabParam !== null) {
			const parsed = ProfileTab.safeParse(tabParam);
			if (!parsed.success) {
				return Response.json({ ok: false, message: `Unknown tab "${tabParam}".` }, { status: 400 });
			}
			return ProfileBackendService.tab(handle, parsed.data, readActor(ctx));
		}
		return ProfileBackendService.overview(handle, readActor(ctx));
	},
	toBody: toProfileBody,
});

export const handler = define.handlers({ ...read });
