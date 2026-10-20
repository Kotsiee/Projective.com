import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { consoleResponse } from "@features/workspaces/core/console-route.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import {
	resolveEntityCalendar,
	resolveTeamCatalogue,
} from "@features/workspaces/core/workspace-ssr.ts";
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
		const actor = readActor(ctx);
		const outcome = await consoleOutcome(
			"team",
			ctx.params.teamHandle,
			ctx.params.module,
			ctx.url,
			actor,
		);

		if (outcome.kind !== "data") return consoleResponse(outcome);

		// Calendar's union and Catalogue's listings are their own reads (Decision #308) — only the
		// module that shows one pays for it.
		const { workspace, module } = outcome.data;
		const calendar = module === "calendar"
			? await resolveEntityCalendar(workspace, actor, ctx.url)
			: null;
		const catalogue = module === "catalogue"
			? await resolveTeamCatalogue(
				workspace,
				actor,
				ctx.url,
				asAuthenticatedContext(ctx.state.userContext).displayCurrency,
			)
			: null;

		ctx.state.title = `${workspace.name} · Team`;
		return page({ ...outcome.data, calendar, catalogue });
	},
});

export default define.page<typeof handler>(function TeamModulePage({ data }) {
	return (
		<ModuleScreen
			workspace={data.workspace}
			module={data.module}
			view={data.view}
			calendar={data.calendar}
			catalogue={data.catalogue}
		/>
	);
});
