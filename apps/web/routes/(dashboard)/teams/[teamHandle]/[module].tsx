import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { consoleResponse } from "@features/workspaces/core/console-route.ts";
import { resolveEntityCalendar, resolveEntityDrive } from "@features/workspaces/core/workspace-ssr.ts";
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
 *
 * `catalogue` never reaches this segment: `/teams/[teamHandle]/catalogue` is a static route, the
 * team's catalogue console (Decision #312).
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

		// Calendar's union is its own read (Decision #308) — only the module that shows it pays for it.
		const { workspace, module } = outcome.data;
		const calendar = module === "calendar"
			? await resolveEntityCalendar(workspace, actor, ctx.url)
			: null;
		// Files reads its first drive location the same way (Decision #315).
		const drive = module === "files" ? await resolveEntityDrive(workspace, actor, ctx.url) : null;

		ctx.state.title = `${workspace.name} · Team`;
		return page({ ...outcome.data, calendar, drive });
	},
});

export default define.page<typeof handler>(function TeamModulePage({ data }) {
	return (
		<ModuleScreen
			workspace={data.workspace}
			module={data.module}
			view={data.view}
			calendar={data.calendar}
			drive={data.drive}
		/>
	);
});
