import { define } from "@web/utils/state.ts";
import { InstantiateServiceInputSchema } from "@projective/types/services";
import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import { bookingActorFrom } from "@features/view/core/booking-actor.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";

/**
 * `POST /api/services/instantiate-pipeline` — copy a Pipeline service template into the acting
 * client's workspace as a DRAFT project. The write behind "Add to Projects".
 *
 * Thin: parse, resolve the actor from the session, delegate to
 * {@link ProjectBackendService.instantiateService} — which owns every rule, including that the listing
 * must actually BE a pipeline, and which returns the existing draft rather than a second one for a
 * repeated `idempotencyKey`.
 *
 * **No money moves.** The draft carries `status = 'draft'`, `visibility = 'unlisted'` and freelancer
 * assignments parked at `pending_funding`, because a pipeline is not bought — it is staffed and then
 * bought against, one ticket at a time (`PRODUCT_SPEC.md` §Creation & Purchasing Gate).
 *
 * The route deliberately carries no capability guard. A hard `isFreelancer`-style server bounce is
 * incompatible with the client-side Dev Context Switcher (the server never sees the persona override),
 * so the `(dashboard)` guard bounces guests, the fat service refuses an unresolved actor, and the
 * deferred `projects.*` RLS is the real gate — consistent with Decisions #14/#16/#53.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = InstantiateServiceInputSchema.safeParse(raw);
		if (!parsed.success) return invalidPayload(parsed.error);

		const actor = bookingActorFrom(ctx.state);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to add this to your projects." },
				{ status: 401 },
			);
		}
		return toBookingResponse(
			ProjectBackendService.instantiateService(parsed.data, { userId: actor.userId }),
		);
	},
});
