import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { preserveSim } from "@features/workspaces/core/workspace-seam.ts";
import { ModuleScreen } from "@features/workspaces/components/ModuleScreen.tsx";

/**
 * `/businesses/[businessId]/[module]` — every business console module behind one dynamic segment.
 *
 * The registry is kind-aware, so a business never resolves `payouts` or `catalogue` (it buys, it does
 * not deliver): those segments redirect rather than rendering an empty seller screen. See the team twin
 * for why the redirect must live in the handler.
 */
export const handler = define.handlers({
	GET(ctx) {
		const outcome = consoleOutcome(
			"business",
			ctx.params.businessId,
			ctx.params.module,
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
				headers: { location: preserveSim(ctx.url, `/businesses/${ctx.params.businessId}`) },
			});
		}

		ctx.state.title = `${outcome.data.workspace.name} · Business`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function BusinessModulePage({ data }) {
	return <ModuleScreen workspace={data.workspace} module={data.module} view={data.view} />;
});
