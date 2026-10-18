import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ContactAttachmentCompleteSchema } from "@projective/types/contact";
import { ContactBackendService } from "@server/services/contact/ContactBackendService.ts";
import { toContactResponse, unreadableBody } from "@features/contact/core/contact-respond.ts";

/**
 * `POST /api/contact/attachments/complete` — step 3 of a `/contact` attachment (Decision #276):
 * `{ attachmentId }` → the admitted `ContactAttachment`, or why it was refused. Thin: Zod, then the
 * fat {@link ContactBackendService.completeAttachment}, which claims the row (`scanning`), sniffs the
 * landed bytes and promotes them into the private `contact` bucket — or refuses them (422) and keeps
 * nothing.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => undefined);
		const parsed = ContactAttachmentCompleteSchema.safeParse(raw);
		if (!parsed.success) return unreadableBody();
		return toContactResponse(
			await ContactBackendService.completeAttachment(parsed.data.attachmentId, readActor(ctx)),
		);
	},
});
