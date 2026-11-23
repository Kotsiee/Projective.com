import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import {
	invalid,
	readJsonBody,
	signedOut,
	toCatalogueResponse,
} from "@features/catalogue/core/respond.ts";
import { invalidQuery, parseReadQuery } from "@features/catalogue/core/read-query.ts";
import {
	GroupScheduleModeSchema,
	OpenCohortInputSchema,
	SaveGroupScheduleInputSchema,
} from "@projective/types/projects";
import { CatalogueCohortsBackendService } from "@server/services/catalogue/CatalogueCohortsBackendService.ts";

/**
 * `/api/catalogue/cohorts` — thin route over a group-session listing's cohorts, as the signed-in
 * seller (Decision #498; `?team=` as every catalogue route).
 *
 * `GET ?listing=` reads the listing's cohorts and the opening form's facts
 * ({@link CatalogueCohortsBackendService.cohorts}); `sim` is the `clientPipeline` dev axis and
 * `schedule` the `groupSchedule` one, both honoured only by the fixture path. `POST` {@link OpenCohortInputSchema} opens the next cohort
 * ({@link CatalogueCohortsBackendService.open}): 403 for a 13–17 account, 422 for terms the database
 * refuses, 409 while another cohort is taking bookings or a sitting clashes with the calendar.
 * `PUT` {@link SaveGroupScheduleInputSchema} saves how the cohorts open (fixed cohorts or rolling weekly
 * templates, SC11) and answers the cohorts as they now stand
 * ({@link CatalogueCohortsBackendService.saveSchedule}): 422 for a week the database refuses.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const parsed = parseReadQuery(ctx.url.searchParams);
		if (!parsed.ok) return invalidQuery(parsed.errors);
		const { listing, sim } = parsed.query;
		if (!listing) return invalidQuery({ listing: "Name the listing." });
		const schedule = GroupScheduleModeSchema.safeParse(ctx.url.searchParams.get("schedule")).data ??
			null;
		return toCatalogueResponse(
			await CatalogueCohortsBackendService.cohorts(listing, actor, { sim, schedule }),
		);
	},

	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const parsed = OpenCohortInputSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(await CatalogueCohortsBackendService.open(parsed.data, actor));
	},

	async PUT(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const parsed = SaveGroupScheduleInputSchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toCatalogueResponse(
			await CatalogueCohortsBackendService.saveSchedule(parsed.data, actor),
		);
	},
});
