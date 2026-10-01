import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { SetGroupPhotoSchema } from "@projective/types/messaging";
import { toMessagingResponse } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";

/**
 * `POST /api/messaging/conversations/[id]/photo` `{ photo: { sourceAssetId, crop? } | null }` — thin
 * route: set or clear a GROUP conversation's photo. Zod-validated, then delegated to the fat
 * {@link MessagingBackendService.setGroupPhoto}, which cuts the square rendition from one of the
 * caller's own library stills and hangs it on the thread through `comms.set_group_photo` (any member
 * may; a stranger and a non-group are refused there). The 401 is an identity check — the picture
 * comes from the caller's own media library, which a guest does not have.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json(
				{ ok: false, message: "Sign in to change a group's photo." },
				{ status: 401 },
			);
		}
		const parsed = SetGroupPhotoSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "Choose a picture from your library.", errors: { photo: "invalid" } },
				{ status: 422 },
			);
		}
		return toMessagingResponse(
			await MessagingBackendService.setGroupPhoto(ctx.params.id, parsed.data, actor),
		);
	},
});
