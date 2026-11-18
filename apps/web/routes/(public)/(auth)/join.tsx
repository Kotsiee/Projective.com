import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import JoinExperience from "@features/auth/islands/JoinExperience.island.tsx";
import { readRedirect } from "@features/auth/core/redirect.ts";
import { parseOAuthPrefill } from "@features/auth/core/oauth.ts";
import { isOwnerCompletion, isTermsCompletion } from "@features/auth/core/auth-routing.ts";
import { reacceptDocuments } from "@features/legal/core/reaccept.ts";
import { isTermsDueRequest } from "@web/utils/terms-gate.ts";
import { captchaSiteKeyFor } from "@features/auth/core/captcha.ts";
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
 *
 * `/join?complete=terms` is the re-accept state (Decision #446): a signed-in, onboarded person whose
 * token says `termsDue` (or the Dev Context Switcher's `pj.dev.terms` override) sees the changed
 * documents and the consent box. Anyone else goes to the captured path.
 *
 * A sign-up's final step carries the Turnstile bot check `/api/auth/join` verifies (Decision #447);
 * both completion states are signed in, so they get no site key.
 */
export const handler = define.handlers({
	GET(ctx) {
		ctx.state.title = "Join Projective";
		ctx.state.description = "Create your Projective account — hire, work, and get paid by stage.";
		const params = ctx.url.searchParams;
		const redirectTo = readRedirect(params);
		const complete = isOwnerCompletion(params)
			? "owner" as const
			: isTermsCompletion(params)
			? "terms" as const
			: null;
		const context = ctx.state.userContext;
		const allowed = complete === "owner"
			? ctx.state.isAuthenticated && context?.onboarded === false
			: complete === "terms"
			? ctx.state.isAuthenticated && context?.onboarded !== false &&
				isTermsDueRequest(ctx.req, context)
			: true;
		if (!allowed) {
			return new Response(null, {
				status: 302,
				headers: { location: new URL(redirectTo, ctx.url).href },
			});
		}
		if (complete === "terms") ctx.state.title = "Accept the updated terms";
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
			reaccept: complete === "terms" ? reacceptDocuments() : undefined,
			captchaSiteKey: complete ? null : captchaSiteKeyFor(ctx.req),
		});
	},
});

export default define.page<typeof handler>(function JoinRoute({ data }) {
	return <JoinExperience {...data} />;
});
