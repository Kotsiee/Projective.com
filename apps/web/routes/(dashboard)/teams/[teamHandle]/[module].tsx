import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { workspaceHref } from "@projective/types/workspace";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { ModuleScreen } from "@features/workspaces/components/ModuleScreen.tsx";

/**
 * `/teams/[teamHandle]/[module]` — every team console module behind one dynamic segment.
 *
 * The module registry is the route validator: adding a module is one array entry plus one component,
 * with no route file to remember.
 *
 * The redirect lives in the HANDLER, not the component: a page component renders JSX, so a `Response`
 * returned from one is ignored and the reader gets an empty body. So a real module the viewer may not
 * open 303s to the one they can, while an unregistered segment falls back to the console (a bad link
 * should not silently resolve somewhere plausible).
 */
export const handler = define.handlers({
	async GET(ctx) {
		const outcome = await consoleOutcome(
			"team",
			ctx.params.teamHandle,
			ctx.params.module,
			ctx.url,
			readActor(ctx),
		);

		if (outcome.kind === "redirect") {
			return new Response(null, { status: 303, headers: { location: outcome.to } });
		}
		if (outcome.kind === "missing") {
			return new Response(null, {
				status: 303,
				headers: { location: workspaceHref("team", encodeURIComponent(ctx.params.teamHandle)) },
			});
		}

		ctx.state.title = `${outcome.data.workspace.name} · Team`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function TeamModulePage({ data }) {
	return <ModuleScreen workspace={data.workspace} module={data.module} view={data.view} />;
});
