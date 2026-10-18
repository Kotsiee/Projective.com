import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ContactBackendService } from "@server/services/contact/ContactBackendService.ts";
import {
	isJsonRequest,
	toContactResponse,
	unreadableBody,
	unsupportedBody,
} from "@features/contact/core/contact-respond.ts";

/**
 * `POST /api/contact/attachments/init` — step 1 of a `/contact` attachment (Decision #276):
 * `{ name, mimeType, sizeBytes }` → a `ContactAttachmentTicket` (where to PUT the bytes). Thin: the
 * fat {@link ContactBackendService.initAttachment} checks the session (signed-in senders only — a
 * file belongs to an account), the `contact` bucket's limits and the rate, then mints the quarantine
 * row and its signed URL through the files upload pipeline. Step 2 is the browser's PUT, never a
 * route; step 3 is `…/complete`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!isJsonRequest(ctx.req)) return unsupportedBody();
		const raw = await ctx.req.json().catch(() => undefined);
		if (raw === undefined) return unreadableBody();
		return toContactResponse(await ContactBackendService.initAttachment(raw, readActor(ctx)));
	},
});
