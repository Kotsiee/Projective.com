import { define } from "@web/utils/state.ts";
import { onboardingReturnPath, PayoutAccountScopeSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `GET /api/finance/connect/refresh?scope=personal|team|business&teamId=…&businessId=…&back=settings` —
 * Stripe's `refresh_url`.
 *
 * An onboarding link is single-use and short-lived; Stripe sends the browser here when one has expired
 * or been reused. This mints a fresh link for the EXISTING account and redirects to it (303). It never
 * creates an account. Anything it cannot do lands back on the page the flow started from with a reason
 * code rather than on a raw error page, because the person arriving here is mid-way through a Stripe
 * flow in a browser.
 *
 * A browser redirect, not an API call: authenticated by the session cookie like every `/api/*` route,
 * and sent to sign-in when there is none.
 */
function back(path: string, params: Record<string, string>): Response {
	const url = new URL(path, "http://placeholder");
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	return new Response(null, { status: 303, headers: { location: `${url.pathname}${url.search}` } });
}

export const handler = define.handlers({
	async GET(ctx) {
		const q = ctx.url.searchParams;
		const returnTo = q.get("back") === "settings" ? "settings" : null;
		const actor = readActor(ctx);
		if (!actor.userId) {
			return new Response(null, {
				status: 303,
				headers: { location: withRedirect("/login", returnTo ? "/settings/verification" : "/wallet") },
			});
		}
		const owner = PayoutAccountScopeSchema.safeParse({
			scope: q.get("scope"),
			teamId: q.get("teamId"),
			businessId: q.get("businessId"),
		});
		if (!owner.success) return back(returnTo ? "/settings/verification" : "/wallet", { payouts: "invalid_link" });
		const landing = onboardingReturnPath(owner.data, returnTo);

		const result = await PaymentBackendService.refreshConnectOnboarding(owner.data, actor, returnTo);
		if (!result.ok || !result.data) {
			return back(landing, { payouts: result.status === 404 ? "not_started" : "unavailable" });
		}
		return new Response(null, {
			status: 303,
			headers: { location: result.data.url, "cache-control": "no-store" },
		});
	},
});
