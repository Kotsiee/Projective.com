import { define } from "@web/utils/state.ts";
import { NEWSLETTER_PATHS } from "@projective/types/community";
import { clientKey } from "@web/utils/client-key.ts";
import {
	NEWSLETTER_LINK_HEADERS,
	NEWSLETTER_THROTTLED_NOTICE,
	newsletterPageHref,
	newsletterRedirect,
} from "@features/marketing/newsletter/core/newsletter-link.ts";
import { NewsletterBackendService } from "@server/services/newsletter/NewsletterBackendService.ts";

/**
 * `/api/newsletter/confirm` — the newsletter's double opt-in, confirmed by a person's press
 * (PRD-E11, the #445 pattern).
 *
 * - `GET` writes nothing. It `303`s to `/newsletter/confirm` with the same query, so a mail scanner
 *   or a pasted link lands on the page with the Confirm button.
 * - `POST` is that press: the `/api` guard checks it came from this site (a plain form body is
 *   allowed here, `utils/csrf.ts`), the fat {@link NewsletterBackendService} throttles per client and
 *   applies the confirmation. A form post `303`s back to the page, which shows the address's new
 *   standing (subscribed, or the link expired); a throttled press returns with the notice and the
 *   token unspent. A JSON post answers JSON with the service's status.
 */
export const handler = define.handlers({
	GET(ctx) {
		return newsletterRedirect(`${NEWSLETTER_PATHS.confirmPage}${ctx.url.search}`);
	},

	async POST(ctx) {
		const json = (ctx.req.headers.get("content-type") ?? "").includes("application/json");
		const body = json ? await ctx.req.json().catch(() => null) as { token?: unknown } | null : null;
		const form = json ? null : await ctx.req.formData().catch(() => null);
		const raw = json ? body?.token : form?.get("token") ?? ctx.url.searchParams.get("token");
		const token = typeof raw === "string" ? raw : null;

		const result = await NewsletterBackendService.confirm(
			token,
			clientKey(ctx.info.remoteAddr, ctx.req.headers),
		);

		if (json) {
			return Response.json(
				{ ok: result.ok, message: result.message, data: result.data, details: result.details },
				{ status: result.status, headers: NEWSLETTER_LINK_HEADERS },
			);
		}
		return newsletterRedirect(
			newsletterPageHref(
				"confirm",
				token,
				result.status === 429 ? NEWSLETTER_THROTTLED_NOTICE : undefined,
			),
		);
	},
});
