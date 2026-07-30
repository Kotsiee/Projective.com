import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { preserveSim } from "@features/workspaces/core/workspace-seam.ts";
import { ModuleScreen } from "@features/workspaces/components/ModuleScreen.tsx";

/**
 * `/teams/[teamId]` — a team's console, landing on Overview.
 *
 * Overview is permissionless in the module registry, so this address is reachable by every active
 * member — which is what makes the "never 404 a user out of their own workspace" invariant satisfiable
 * at all, and why the `[module]` route can always redirect somewhere real.
 */
export const handler = define.handlers({
	GET(ctx) {
		const outcome = consoleOutcome(
			"team",
			ctx.params.teamId,
			"overview",
			ctx.url,
			asAuthenticatedContext(ctx.state.userContext),
		);

		if (outcome.kind === "redirect") {
			return new Response(null, {
				status: 303,
				headers: { location: preserveSim(ctx.url, outcome.to) },
			});
		}
		if (outcome.kind === "missing") {
			return new Response(null, {
				status: 303,
				headers: { location: preserveSim(ctx.url, "/teams") },
			});
		}

		ctx.state.title = `${outcome.data.workspace.name} · Team`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function TeamOverviewPage({ data }) {
	return <ModuleScreen workspace={data.workspace} module={data.module} view={data.view} />;
});
