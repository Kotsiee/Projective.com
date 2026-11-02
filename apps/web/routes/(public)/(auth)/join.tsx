import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import JoinExperience from "@features/auth/islands/JoinExperience.island.tsx";
import { readRedirect } from "@features/auth/core/redirect.ts";
import { parseOAuthPrefill } from "@features/auth/core/oauth.ts";
import { isOwnerCompletion } from "@features/auth/core/auth-routing.ts";
import type { AccountType, UserIntent } from "@features/auth/types/mod.ts";

/**
 * `/join` — account creation (canonical signup route; supersedes `/register`). Thin controller: it
 * parses the return path, account type, initial intent, and any Google OAuth pre-fill off the URL
 * server-side, then hands them to the JoinForm island. The island owns the interactive flow
 * (individual quick form ⇄ enterprise wizard, age-gate, validation).
 *
 * `/join?complete=owner` is the completion state: a signed-in enterprise owner with no profile gives
 * the name and date of birth step 1.6 now asks for (Decision #336, ruling I2). Only that account
 * sees it. Anyone else goes to the captured path: a guest's session may need renewing, which the
 * dashboard guard does before it sends the owner back here, and an account with a profile has
 * nothing to complete.
 */
export const handler = define.handlers({
	GET(ctx) {
		ctx.state.title = "Join Projective";
		ctx.state.description = "Create your Projective account — hire, work, and get paid by stage.";
		const params = ctx.url.searchParams;
		const redirectTo = readRedirect(params);
		const complete = isOwnerCompletion(params) ? "owner" as const : null;
		if (complete && !(ctx.state.isAuthenticated && ctx.state.userContext?.onboarded === false)) {
			return new Response(null, {
				status: 302,
				headers: { location: new URL(redirectTo, ctx.url).href },
			});
		}
		const accountType: AccountType = params.get("type") === "enterprise"
			? "enterprise"
			: "individual";
		const intentParam = params.get("intent");
		const intent: UserIntent | "" = intentParam === "freelancer"
			? "freelancer"
			: intentParam === "client"
			? "client"
			: "";
		return page({
			redirectTo,
			accountType,
			intent,
			prefill: parseOAuthPrefill(params),
			complete,
		});
	},
});

export default define.page<typeof handler>(function JoinRoute({ data }) {
	return <JoinExperience {...data} />;
});
