import { define } from "@web/utils/state.ts";
import { NEWSLETTER_PATHS } from "@projective/types/community";
import {
	NEWSLETTER_LINK_HEADERS,
	newsletterPageHref,
	newsletterRedirect,
} from "@features/marketing/newsletter/core/newsletter-link.ts";
import { NewsletterBackendService } from "@server/services/newsletter/NewsletterBackendService.ts";

/**
 * `/api/newsletter/unsubscribe` — the URL every newsletter mail's `List-Unsubscribe` header names
 * (PRD-E11, RFC 8058).
 *
 * - `GET` writes nothing. It `303`s to `/newsletter/unsubscribe` with the same query: an older mail
 *   client opens the header's URL in a browser, and a mail scanner may fetch it, so the page asks for
 *   a press.
 * - `POST` with the body `List-Unsubscribe=One-Click` is a mail client's one-click unsubscribe. It
 *   takes effect at once and answers plain text. It comes from the mail provider's servers, cross-site
 *   and with no `Origin`, so the `/api` origin guard stands aside for this path (`utils/csrf.ts`): the
 *   token in the URL is the credential.
 * - Any other `POST` (the page's Unsubscribe button, the token in a form field) unsubscribes and
 *   `303`s back to the page, which shows the address unsubscribed.
 *
 * Idempotent, and nothing is deleted. The fat {@link NewsletterBackendService} does the write.
 */
export const handler = define.handlers({
	GET(ctx) {
		return newsletterRedirect(`${NEWSLETTER_PATHS.unsubscribePage}${ctx.url.search}`);
	},

	async POST(ctx) {
		const form = await ctx.req.formData().catch(() => null);
		const oneClick = form?.get("List-Unsubscribe") === "One-Click";
		const raw = form?.get("token") ?? ctx.url.searchParams.get("token");
		const token = typeof raw === "string" ? raw : null;

		const result = await NewsletterBackendService.unsubscribe(
			token,
			oneClick ? "one_click" : "link",
		);

		if (oneClick) {
			return new Response(result.ok ? "Unsubscribed." : result.message ?? "Not found.", {
				status: result.ok ? 200 : result.status,
				headers: { "content-type": "text/plain; charset=utf-8", ...NEWSLETTER_LINK_HEADERS },
			});
		}
		return newsletterRedirect(newsletterPageHref("unsubscribe", token));
	},
});
