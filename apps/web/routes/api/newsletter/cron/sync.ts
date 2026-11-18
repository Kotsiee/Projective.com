import { define } from "@web/utils/state.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import {
	DEFAULT_SYNC_LIMIT,
	NewsletterProviderSync,
} from "@server/services/newsletter/provider-sync.ts";

/**
 * `POST /api/newsletter/cron/sync?limit=50` — the scheduler's entry point for the newsletter's
 * provider sync, the `newsletter-provider-sync` http job (every 5 minutes; CD1 step 5, Decision #480
 * Q1 A): one pass of `NewsletterProviderSync.run`, which pushes each send-eligible address to the
 * mail provider's contact list and deletes the contact of an address that left.
 *
 * Authenticated by the dispatcher's own `COMMS_DISPATCH_SECRET` in constant time, so outbound mail
 * keeps one Vault entry; anything else is a 404, as the other cron routes answer: an endpoint that
 * acts on Projective's behalf does not advertise that it exists. The body is ignored; the answer is
 * counts only, never an address. The `/api` write guard exempts `/api/…/cron/…` (no browser posts
 * here).
 */
export const handler = define.handlers({
	async POST(ctx) {
		if (!NewsletterProviderSync.isAuthorised(ctx.req.headers.get("authorization"))) {
			return new Response(null, { status: 404 });
		}
		const limit = Number(ctx.url.searchParams.get("limit") ?? DEFAULT_SYNC_LIMIT);
		return serviceResponse(await NewsletterProviderSync.run(limit));
	},
});
