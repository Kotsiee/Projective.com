import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { ModuleScreen } from "@features/workspaces/components/ModuleScreen.tsx";

/**
 * `/teams/[teamHandle]` — a team's console, landing on Overview. Addressed by the team's `@handle`, the
 * same address as its public profile; a row id or a differently-cased handle 303s to it.
 *
 * Overview is permissionless in the module registry, so this address is reachable by every active
 * member — which is what makes the "never 404 a user out of their own workspace" invariant satisfiable,
 * and why the `[module]` route can always redirect somewhere real. Somebody who is not a member (or a
 * team that does not exist) is sent back to their roster rather than shown an empty console.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const outcome = await consoleOutcome(
			"team",
			ctx.params.teamHandle,
			"overview",
			ctx.url,
			readActor(ctx),
		);

		if (outcome.kind === "redirect") {
			return new Response(null, { status: 303, headers: { location: outcome.to } });
		}
		if (outcome.kind === "missing") {
			return new Response(null, { status: 303, headers: { location: "/teams" } });
		}

		ctx.state.title = `${outcome.data.workspace.name} · Team`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function TeamOverviewPage({ data }) {
	return <ModuleScreen workspace={data.workspace} module={data.module} view={data.view} />;
});
