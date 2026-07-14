import { define } from "@web/utils/state.ts";
import { NewsletterSubscribeSchema } from "@projective/types/newsletter";
import { toNewsletterResponse } from "@features/marketing/core/newsletter-respond.ts";
import { NewsletterBackendService } from "@server/services/newsletter/NewsletterBackendService.ts";

/**
 * `POST /api/newsletter/subscribe` — thin route: parse + Zod-validate the opt-in body, then delegate
 * to the fat {@link NewsletterBackendService}, mapping its {@link ServiceResult} to a `Response`. The
 * footer's `NewsletterForm` island calls this via the thin `NewsletterService`; no logic or list
 * writes happen here (SYSTEM_ARCHITECTURE.md §2 — thin routes, fat services).
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
		return toNewsletterResponse(NewsletterBackendService.subscribe(parsed.data));
	},
});
