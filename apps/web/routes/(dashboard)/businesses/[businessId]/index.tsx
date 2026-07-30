import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { preserveSim } from "@features/workspaces/core/workspace-seam.ts";
import { ModuleScreen } from "@features/workspaces/components/ModuleScreen.tsx";

/**
 * `/businesses/[businessId]` — a business's console, landing on Overview.
 *
 * The same resolver the team route uses, with one argument changed — the two kinds share one
 * implementation by construction rather than by discipline.
 */
export const handler = define.handlers({
	GET(ctx) {
		const outcome = consoleOutcome(
			"business",
			ctx.params.businessId,
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
				headers: { location: preserveSim(ctx.url, "/businesses") },
			});
		}

		ctx.state.title = `${outcome.data.workspace.name} · Business`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function BusinessOverviewPage({ data }) {
	return <ModuleScreen workspace={data.workspace} module={data.module} view={data.view} />;
});
