import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import JoinExperience from "@features/auth/islands/JoinExperience.island.tsx";
import { readRedirect } from "@features/auth/core/redirect.ts";
import { parseOAuthPrefill } from "@features/auth/core/oauth.ts";
import type { AccountType, UserIntent } from "@features/auth/types/mod.ts";

/**
 * `/join` — account creation (canonical signup route; supersedes `/register`). Thin controller: it
 * parses the return path, account type, initial intent, and any Google OAuth pre-fill off the URL
 * server-side, then hands them to the JoinForm island. The island owns the interactive flow
 * (individual quick form ⇄ organization wizard, age-gate, validation).
 */
export const handler = define.handlers({
	GET(ctx) {
		ctx.state.title = "Join Projective";
		ctx.state.description = "Create your Projective account — hire, work, and get paid by stage.";
		const params = ctx.url.searchParams;
		const accountType: AccountType = params.get("type") === "organization"
			? "organization"
			: "individual";
		const intentParam = params.get("intent");
		const intent: UserIntent | "" = intentParam === "freelancer"
			? "freelancer"
			: intentParam === "client"
			? "client"
			: "";
		return page({
			redirectTo: readRedirect(params),
			accountType,
			intent,
			prefill: parseOAuthPrefill(params),
		});
	},
});

export default define.page<typeof handler>(function JoinRoute({ data }) {
	return <JoinExperience {...data} />;
});
