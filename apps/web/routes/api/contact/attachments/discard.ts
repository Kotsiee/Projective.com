import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ContactAttachmentDiscardSchema } from "@projective/types/contact";
import { ContactBackendService } from "@server/services/contact/ContactBackendService.ts";
import {
	isJsonRequest,
	toContactResponse,
	unreadableBody,
	unsupportedBody,
} from "@features/contact/core/contact-respond.ts";

/**
 * `POST /api/contact/attachments/discard` — Remove on a `/contact` attachment that has not been sent
 * (Decision #276): `{ attachmentId }` → `{ id }`. Thin: Zod, then the fat
 * {@link ContactBackendService.discardAttachment}, which soft-deletes the caller's own unsent row and
 * deletes its bytes — 404 when it is not theirs, already sent or gone; 409 while it is being checked.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!isJsonRequest(ctx.req)) return unsupportedBody();
		const raw = await ctx.req.json().catch(() => undefined);
		const parsed = ContactAttachmentDiscardSchema.safeParse(raw);
		if (!parsed.success) return unreadableBody();
		return toContactResponse(
			await ContactBackendService.discardAttachment(parsed.data.attachmentId, readActor(ctx)),
		);
	},
});
