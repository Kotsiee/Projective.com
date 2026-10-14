import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { BindListingAvailabilitySchema } from "@projective/types/scheduling";
import { invalid, signedOut, toCatalogueResponse } from "@features/catalogue/core/respond.ts";
import { ScheduleBackendService } from "@server/services/scheduling/ScheduleBackendService.ts";

/**
 * `POST /api/catalogue/availability` — bind a Session or Group Session listing to its schedule's
 * default preset, a library preset, or its own fork of one
 * ({@link ScheduleBackendService.bindListing}). Age gate (no scheduling for 13–17-year-olds, Decision
 * #208), session, Zod, service.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const parsed = BindListingAvailabilitySchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(await ScheduleBackendService.bindListing(parsed.data, actor));
	},
});
