import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { consoleOutcome } from "@features/workspaces/core/workspace-route.tsx";
import { ModuleScreen } from "@features/workspaces/components/ModuleScreen.tsx";

/**
 * `/businesses/[businessHandle]` — a business's console, landing on Overview. Addressed by the
 * business's `@handle`; a row id or a differently-cased handle 303s to it.
 *
 * The same resolver the team route uses, with one argument changed — the two kinds share one
 * implementation by construction rather than by discipline.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const outcome = await consoleOutcome(
			"business",
			ctx.params.businessHandle,
			"overview",
			ctx.url,
			readActor(ctx),
		);

		if (outcome.kind === "redirect") {
			return new Response(null, { status: 303, headers: { location: outcome.to } });
		}
		if (outcome.kind === "missing") {
			return new Response(null, { status: 303, headers: { location: "/businesses" } });
		}

		ctx.state.title = `${outcome.data.workspace.name} · Business`;
		return page(outcome.data);
	},
});

export default define.page<typeof handler>(function BusinessOverviewPage({ data }) {
	return <ModuleScreen workspace={data.workspace} module={data.module} view={data.view} />;
});
