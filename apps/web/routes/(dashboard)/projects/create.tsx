import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import ProjectWizard from "@features/projects/islands/ProjectWizard.island.tsx";
import type { WizardSeed } from "@features/projects/core/wizard-state.ts";
import type { ProjectCreateFormat } from "@projective/types/projects";

/**
 * `/projects/create` — the six-step Project Creation wizard.
 *
 * This route was, for one release, a 307 shim: the standalone page had been replaced by an in-lane
 * creation modal. The modal is retired in turn — a two-panel dialog could hold a name, a brief and a
 * stage list, and had nowhere to put the engagement's legal terms, its screening, its schedule or
 * its staffing, which is most of what makes a project something a freelancer can judge. The page is
 * back, and it is the whole flow (`documentation/flows/Projects.md` §1).
 *
 * It must stay a **static** sibling of `[projectId]` so `create` is never captured as a project
 * slug; `_layout.tsx`'s own `projectSlugOf` maps it to the feed lane for the same reason.
 *
 * **Thin route.** It resolves the one thing the wizard cannot know about itself — which workspace
 * the actor is acting for — and renders the island. It performs no capability guard: the acting
 * persona is a client seam the server never sees (Decision #53(b)), the `(dashboard)` middleware
 * already bounces a guest, and `projects.create_project` derives the owner from `auth.uid()` and
 * verifies membership before it writes, so the real gate is where the write is.
 */

// #region Seeding
/**
 * The work-flow the wizard opens on.
 *
 * `?type=` is a launcher hint, not a stored value, so an unknown one falls through to the schema's
 * own default rather than refusing the page. `direct_deliverable` is accepted and DEMOTED, because
 * it is not a third work-flow — it is the stages-off variant of a one-off, and the Stages step's
 * toggle is where that decision belongs.
 */
function seedFor(
	requested: string | null,
	scopeType: WizardSeed["scopeType"],
	scopeId: string,
): WizardSeed {
	const format: ProjectCreateFormat = requested === "one_off" || requested === "direct_deliverable"
		? "one_off"
		: "pipeline";
	return {
		format,
		hasStages: requested !== "direct_deliverable",
		scopeType,
		scopeId,
	};
}
// #endregion

export const handler = define.handlers({
	GET(ctx) {
		const context = asAuthenticatedContext(ctx.state.userContext);
		ctx.state.title = "New project · Projective";
		return page({
			seed: seedFor(
				new URL(ctx.req.url).searchParams.get("type"),
				context.contextType,
				context.contextId,
			),
			ownerId: context.userId,
		});
	},
});

export default define.page<typeof handler>(function ProjectCreatePage({ data }) {
	return <ProjectWizard seed={data.seed} ownerId={data.ownerId} />;
});
