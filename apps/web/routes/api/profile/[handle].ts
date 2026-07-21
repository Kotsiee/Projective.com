import { define } from "@web/utils/state.ts";
import { ProfileTab } from "@projective/types/profile";
import { toProfileResponse } from "@features/profile/core/respond.ts";
import { ProfileBackendService } from "@server/services/profile/ProfileBackendService.ts";

/**
 * `GET /api/profile/:handle` — thin route: delegate to the fat {@link ProfileBackendService} for the
 * profile overview projection, or (with `?tab=`) one tab's payload. HTTP parsing + the tab-enum guard
 * only; the service owns resolution, the reserved-handle denylist, and the stub/live gate. Backs the
 * client {@link ProfileService} refinement path; SSR calls the service directly.
 */
export const handler = define.handlers({
	GET(ctx) {
		const handle = ctx.params.handle;
		const tabParam = ctx.url.searchParams.get("tab");
		if (tabParam !== null) {
			const parsed = ProfileTab.safeParse(tabParam);
			if (!parsed.success) {
				return Response.json({ ok: false, message: `Unknown tab "${tabParam}".` }, { status: 400 });
			}
			return toProfileResponse(ProfileBackendService.tab(handle, parsed.data));
		}
		return toProfileResponse(ProfileBackendService.overview(handle));
	},
});
