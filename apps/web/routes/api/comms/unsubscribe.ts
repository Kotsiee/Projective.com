import { define } from "@web/utils/state.ts";
import { MarketingUnsubscribeService } from "@server/services/comms/MarketingUnsubscribeService.ts";

/**
 * `/api/comms/unsubscribe` — the URL a marketing email's `List-Unsubscribe` header names, for an
 * account (COMMS NT3, RFC 8058). The newsletter's anonymous list has its own door beside it,
 * `/api/newsletter/unsubscribe`.
 *
 * - `GET` writes nothing: a mail scanner may fetch the header's URL, and an older client opens it in a
 *   browser. It `303`s to Settings → Notifications, where the person chooses (PRD-C11).
 * - `POST` (the mail client's one-click, `List-Unsubscribe=One-Click`, or any form post) spends the
 *   signed link in `?token=` at once and answers plain text. It comes from the mail provider's
 *   servers, cross-site and with no `Origin`, so the `/api` origin guard stands aside for this path
 *   (`utils/csrf.ts`, a form body or none): the signed token is the credential.
 *
 * The fat {@link MarketingUnsubscribeService} does the write; nothing is deleted.
 */
const HEADERS = {
	"cache-control": "no-store",
	"referrer-policy": "no-referrer",
	"content-type": "text/plain; charset=utf-8",
};

export const handler = define.handlers({
	GET() {
		return new Response(null, {
			status: 303,
			headers: {
				location: "/settings/notifications",
				"cache-control": "no-store",
				"referrer-policy": "no-referrer",
			},
		});
	},

	async POST(ctx) {
		const form = await ctx.req.formData().catch(() => null);
		const field = form?.get("token");
		const token = typeof field === "string" ? field : ctx.url.searchParams.get("token");
		const result = await MarketingUnsubscribeService.unsubscribe(token);
		return new Response(result.message ?? (result.ok ? "Unsubscribed." : "Not found."), {
			status: result.ok ? 200 : result.status,
			headers: HEADERS,
		});
	},
});
