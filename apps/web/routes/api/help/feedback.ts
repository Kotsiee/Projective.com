import { define } from "@web/utils/state.ts";
import { serviceResponse } from "@web/utils/service-response.ts";
import { readActor } from "@web/utils/api-session.ts";
import { HelpFeedbackBackendService } from "@server/services/community/HelpFeedbackBackendService.ts";
import {
	FEEDBACK_FIELD,
	feedbackReturnUrl,
	isFormPost,
	parseFeedbackForm,
} from "@features/help/core/feedback-form.ts";

/** The caller's transport address — a guest's rate-limit key. */
function clientKey(remote: Deno.Addr): string {
	return "hostname" in remote ? remote.hostname : remote.transport;
}

/**
 * `POST /api/help/feedback` — "Was this helpful?" on a help article (P2). Open to guests; thin route:
 * read the body — JSON `{ slug, helpful, comment? }` from the island, or the no-JavaScript form
 * (`slug`, `helpful=yes|no`, `comment`, `back`) — resolve who is voting (the verified session's
 * token when signed in, the transport address either way) and hand both to
 * {@link HelpFeedbackBackendService.submit}, which validates, rate-limits and writes through
 * `community.submit_help_feedback`.
 *
 * JSON answers the flat envelope (422 · 404 · 429 with `Retry-After` · 503); a form post answers a
 * 303 back to the article it came from (only ever a `/help` path) with `?helpful=thanks|error`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const form = isFormPost(ctx.req.headers.get("content-type"));
		let body: unknown;
		let back: string | null = null;
		if (form) {
			const data = await ctx.req.formData().catch(() => null);
			body = data ? parseFeedbackForm(data) : {};
			const raw = data?.get(FEEDBACK_FIELD.back);
			back = typeof raw === "string" ? raw : null;
		} else {
			body = await ctx.req.json().catch(() => ({}));
		}

		const actor = readActor(ctx);
		const signedIn = ctx.state.isAuthenticated === true && Boolean(actor.accessToken);
		const result = await HelpFeedbackBackendService.submit(body, {
			clientKey: clientKey(ctx.info.remoteAddr),
			userId: signedIn ? actor.userId : undefined,
			accessToken: signedIn ? actor.accessToken : undefined,
		});

		if (form) {
			return new Response(null, {
				status: 303,
				headers: { location: feedbackReturnUrl(back, result.ok ? "thanks" : "error") },
			});
		}
		const res = serviceResponse(result);
		const retryAt = result.details?.retryAt;
		if (result.status === 429 && typeof retryAt === "string") {
			const seconds = Math.max(1, Math.ceil((Date.parse(retryAt) - Date.now()) / 1000));
			res.headers.set("retry-after", String(seconds));
		}
		return res;
	},
});
