import { ProjectNavActivityService } from "@server/services/projects/ProjectNavActivityService.ts";
import type { ReadActor } from "@server/services/read-actor.ts";
import type { State } from "@web/utils/state.ts";
import type { ProjectNavActivity } from "../types/projects-types.ts";

/**
 * The viewer's lane activity for `slug`, read once per request and kept on `state`. SERVER-ONLY.
 *
 * The Overview's handler and the layout's lane both need it on `/projects/[slug]`, and two reads could
 * straddle a write and disagree about what changed; the first caller reads, the second reuses.
 */
export async function resolveNavActivity(
	state: State,
	slug: string,
	actor: ReadActor,
): Promise<ProjectNavActivity> {
	const kept = state.projectNavActivity;
	if (kept && kept.slug === slug) return kept.activity;
	const activity = await ProjectNavActivityService.activity(slug, actor);
	state.projectNavActivity = { slug, activity };
	return activity;
}
