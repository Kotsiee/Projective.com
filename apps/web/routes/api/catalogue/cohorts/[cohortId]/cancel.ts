import { z } from "zod";
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
import { CancelCohortInputSchema } from "@projective/types/projects";
import { CatalogueCohortsBackendService } from "@server/services/catalogue/CatalogueCohortsBackendService.ts";

/** The body names the listing the cohort belongs to, so the answer can carry its cohorts after. */
const CancelBodySchema = z.object({ listing: z.string().min(1).max(160) });

/**
 * `POST /api/catalogue/cohorts/:cohortId/cancel` `{ listing }` — thin route: the seller cancels one of
 * a group-session listing's cohorts before its first sitting ({@link CatalogueCohortsBackendService.cancel},
 * Decision #498). Every seat is refunded in full and the waitlist keeps its order. 403 for a 13–17
 * account or a caller who does not manage the listing, 409 once the cohort has started or ended.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		if (!actor.userId) return signedOut();
		const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
		if (restricted) return restricted;
		const id = CancelCohortInputSchema.safeParse({ cohortId: ctx.params.cohortId });
		if (!id.success) return invalid(id.error, "That cohort can't be found.");
		const body = CancelBodySchema.safeParse(await readJsonBody(ctx.req));
		if (!body.success) return invalid(body.error);
		return toCatalogueResponse(
			await CatalogueCohortsBackendService.cancel(body.data.listing, id.data.cohortId, actor),
		);
	},
});
