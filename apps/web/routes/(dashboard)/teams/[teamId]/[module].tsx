import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { preserveSim } from "@features/workspaces/core/workspace-seam.ts";
import { ModuleScreen } from "@features/workspaces/components/ModuleScreen.tsx";

/**
 * `/teams/[teamId]/[module]` — every team console module behind one dynamic segment.
 *
 * The module registry is the route validator: adding a module is one array entry plus one component,
 * with no route file to remember.
 *
 * The redirect lives in the HANDLER, not the component: a page component renders JSX, so a `Response`
 * returned from one is ignored and the reader gets an empty body — which is exactly the dead end the
 * "never 404 a user out of their own workspace" invariant exists to prevent. So a real module the
 * viewer may not open 303s to the one they can, while an unregistered segment falls back to the
 * console (a bad link should not silently resolve somewhere plausible).
 */
export const handler = define.handlers({
	GET(ctx) {
		const outcome = consoleOutcome(
			"team",
			ctx.params.teamId,
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
				headers: { location: preserveSim(ctx.url, `/teams/${ctx.params.teamId}`) },
			});
		}

		ctx.state.title = `${outcome.data.workspace.name} · Team`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function TeamModulePage({ data }) {
	return <ModuleScreen workspace={data.workspace} module={data.module} view={data.view} />;
});
