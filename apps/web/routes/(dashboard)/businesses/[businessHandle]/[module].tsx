import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { consoleResponse } from "@features/workspaces/core/console-route.ts";
import { resolveBench } from "@features/workspaces/core/workspace-ssr.ts";
import { ModuleScreen } from "@features/workspaces/components/ModuleScreen.tsx";

/**
 * `/businesses/[businessHandle]/[module]` — every business console module behind one dynamic segment.
 * The redirect lives in the handler for the reason given on the team twin.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const actor = readActor(ctx);
		const outcome = await consoleOutcome(
			"business",
			ctx.params.businessHandle,
			ctx.params.module,
			ctx.url,
			actor,
		);

		if (outcome.kind !== "data") return consoleResponse(outcome);

		// Talent's bench is its own read (BU5) — only the module that shows it pays for it.
		const bench = outcome.data.module === "talent"
			? await resolveBench(outcome.data.workspace.handle, actor, ctx.url)
			: null;

		ctx.state.title = `${outcome.data.workspace.name} · Business`;
		return page({ ...outcome.data, bench });
	},
});

export default define.page<typeof handler>(function BusinessModulePage({ data }) {
	return (
		<ModuleScreen
			workspace={data.workspace}
			module={data.module}
			view={data.view}
			billing={data.billing}
			bench={data.bench?.bench ?? null}
			benchError={data.bench?.error ?? null}
		/>
	);
});
