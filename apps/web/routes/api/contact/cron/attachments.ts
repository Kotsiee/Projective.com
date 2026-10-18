import { define } from "@web/utils/state.ts";
import { ContactBackendService } from "@server/services/contact/ContactBackendService.ts";
import { toContactResponse } from "@features/contact/core/contact-respond.ts";

/**
 * `POST /api/contact/cron/attachments` — the scheduler's entry point for unsent `/contact`
 * attachments (Decision #276): every contact upload older than six hours that no request links is
 * soft-deleted and its bytes deleted ({@link ContactBackendService.sweepAttachments}). Registered as
 * the job `contact-attachment-sweep` (Decision #203), hourly.
 *
 * Authenticated by a bearer token (`CONTACT_CRON_SECRET`, ≥ 32 characters), compared in constant
 * time; anything else is a 404, as the other cron routes. The body is ignored. Safe to call as often
 * as the scheduler likes: a file is claimed once, and one a submission or a Remove holds is skipped.
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!ContactBackendService.isCronAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Math.min(
			Math.max(Number(ctx.url.searchParams.get("limit") ?? "100") || 100, 1),
			1000,
		);
		return toContactResponse(await ContactBackendService.sweepAttachments(limit));
	},
});
