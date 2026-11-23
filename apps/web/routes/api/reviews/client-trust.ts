import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import {
	invalid,
	readJsonBody,
	signedOut,
	toReviewsResponse,
} from "@features/reviews/core/respond.ts";
import { ClientTrustQuerySchema } from "@projective/types/reviews";
import { ReviewsBackendService } from "@server/services/reviews/ReviewsBackendService.ts";

/**
 * `/api/reviews/client-trust` — thin route over the Informed Consent (Decision #486 (C)).
 *
 * - `GET ?project=prj-…` — whether the project's client is warned (its Client Trust Score under 3.00
 *   from 3 reviews) and, if so, the score, its review count, its reviews page and whether the caller
 *   has acknowledged it. Apply and Accept read it before they act.
 * - `POST { project }` — logs the caller's acknowledgement, once per project. The proposal and hire
 *   doors refuse with 428 until it exists.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const parsed = ClientTrustQuerySchema.safeParse({
			project: new URL(ctx.req.url).searchParams.get("project"),
		});
		if (!parsed.success) return invalid(parsed.error);
		return toReviewsResponse(
			await ReviewsBackendService.clientTrustWarning(parsed.data.project, actor),
		);
	},
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) return signedOut();
		const parsed = ClientTrustQuerySchema.safeParse(await readJsonBody(ctx.req));
		if (!parsed.success) return invalid(parsed.error);
		return toReviewsResponse(
			await ReviewsBackendService.acknowledgeClientTrust(parsed.data.project, actor),
		);
	},
});
