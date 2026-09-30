import { define } from "@web/utils/state.ts";
import { onboardingReturnPath, PayoutAccountScopeSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { withRedirect } from "@features/auth/core/redirect.ts";
import { PaymentBackendService } from "@server/services/finance/PaymentBackendService.ts";

/**
 * `GET /api/finance/connect/return?scope=personal|team|business&teamId=…&businessId=…&back=settings` —
 * Stripe's `return_url`.
 *
 * Arriving here means the person LEFT the hosted flow, not that they finished it: Stripe's own
 * guidance is to re-read the account rather than assume completion. So this re-reads it from Stripe,
 * applies any changed status (which is what flips the freelancer's `payout_ready` earning gate, or a
 * business's KYB), and lands back with the resulting status for the surface to report — the settings
 * page for a business (its KYB check) or when onboarding started there, else the wallet (the team's
 * vault for a team account).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		const q = ctx.url.searchParams;
		const back = q.get("back") === "settings" ? "settings" : null;
		if (!actor.userId) {
			return new Response(null, {
				status: 303,
				headers: { location: withRedirect("/login", back ? "/settings/verification" : "/wallet") },
			});
		}
		const owner = PayoutAccountScopeSchema.safeParse({
			scope: q.get("scope"),
			teamId: q.get("teamId"),
			businessId: q.get("businessId"),
		});
		const target = new URL(
			owner.success ? onboardingReturnPath(owner.data, back) : back ? "/settings/verification" : "/wallet",
			"http://placeholder",
		);
		if (!owner.success) {
			target.searchParams.set("payouts", "invalid_link");
		} else {
			if (owner.data.scope === "team" && owner.data.teamId && target.pathname === "/wallet") {
				target.searchParams.set("w", `team:${owner.data.teamId}`);
			}
			const result = await PaymentBackendService.connectStatus(owner.data, actor, { sync: true });
			target.searchParams.set(
				owner.data.scope === "business" ? "kyb" : "payouts",
				result.ok && result.data ? result.data.status : "unavailable",
			);
		}
		return new Response(null, {
			status: 303,
			headers: { location: `${target.pathname}${target.search}`, "cache-control": "no-store" },
		});
	},
});
