import { define } from "@web/utils/state.ts";
import { NewsletterSubscribeSchema } from "@projective/types/community";
import { toNewsletterResponse } from "@features/marketing/core/newsletter-respond.ts";
import { appCaptchaGate } from "@features/auth/core/captcha.ts";
import { NewsletterBackendService } from "@server/services/newsletter/NewsletterBackendService.ts";

/**
 * `POST /api/newsletter/subscribe` — thin route: parse + Zod-validate the opt-in body
 * (`{ email, source?, topic?, captchaToken? }`; `topic` is `general` or `changelog`, default
 * `general`), then delegate to the fat {@link NewsletterBackendService} with this request's Turnstile
 * check (action `newsletter`), mapping its {@link ServiceResult} to a `Response`. The service runs the
 * check before the write, refusing with the auth pattern's CAPTCHA_REFUSAL, because a confirmation
 * mail follows a subscribe (PRD-E11). The `NewsletterForm` island calls this via the thin
 * `NewsletterService`; no logic or list writes happen here (SYSTEM_ARCHITECTURE.md §2).
 */
export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => ({}));
		const parsed = NewsletterSubscribeSchema.safeParse(body);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return Response.json(
				{
					ok: false,
					errors: {
						[first?.path.join(".") || "email"]: first?.message ?? "Enter a valid email address.",
					},
				},
				{ status: 422 },
			);
		}
		return toNewsletterResponse(
			await NewsletterBackendService.subscribe(parsed.data, {
				captcha: appCaptchaGate(ctx.req, ctx.info.remoteAddr, "newsletter"),
			}),
		);
	},
});
