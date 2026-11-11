import type { ProjectFormat } from "./summary.ts";
import { isTaskProject, PROJECT_TYPE_LABEL, type ProjectStructure } from "./setup.ts";

/**
 * projects.archetype — the ONE discriminator for how an engagement runs, read from its two stored
 * axes (`format` · `structure_variation`). Every surface that names, routes or shapes itself by type
 * asks {@link engagementArchetype} instead of testing `format` or the engagement's `kind`: whether a
 * row came from a service blueprint says who architected it, never how it is delivered.
 *
 * @module
 */

// #region Archetype
/** How an engagement is delivered. A Task is a one-off with no stages (`isTaskProject`). */
export type EngagementArchetype = "task" | "one_off" | "pipeline" | "session";

/** The archetype of a stored engagement. */
export function engagementArchetype(
	format: ProjectFormat,
	structure: ProjectStructure,
): EngagementArchetype {
	if (format === "session") return "session";
	if (isTaskProject(format, structure)) return "task";
	return format === "one_off" ? "one_off" : "pipeline";
}

/** Whether the archetype runs on stages, each with its own channel — a pipeline or a milestone one-off. */
export function isStagedArchetype(archetype: EngagementArchetype): boolean {
	return archetype === "pipeline" || archetype === "one_off";
}
// #endregion

// #region Labels
/** What each archetype is called. The three create-able types share `PROJECT_TYPE_LABEL`. */
export const ENGAGEMENT_ARCHETYPE_LABEL: Record<EngagementArchetype, string> = {
	...PROJECT_TYPE_LABEL,
	session: "Session",
};

/**
 * The type line an engagement's identity header prints: the archetype, then who architected it —
 * "Pipeline service", "Session service", "One-off project".
 */
export function engagementTypeLabel(
	archetype: EngagementArchetype,
	kind: "project" | "service",
): string {
	return `${ENGAGEMENT_ARCHETYPE_LABEL[archetype]} ${kind === "service" ? "service" : "project"}`;
}
// #endregion

// #region Home view
/**
 * The view an engagement opens on once it exists — where "Open project" and every post-create
 * redirect land: a pipeline's Board, a one-off's Timeline, a session's Calendar. A Task has neither a
 * board nor a time axis, so it opens on its root. A one-off whose draft setup is still incomplete opens
 * on its configuration, because its Timeline has no stages to draw yet.
 *
 * Returns the segment after `/projects/{slug}`; `""` is the root.
 */
export function engagementHomeSeg(
	archetype: EngagementArchetype,
	opts: { setupIncomplete?: boolean } = {},
): "board" | "timeline" | "calendar" | "details" | "" {
	switch (archetype) {
		case "pipeline":
			return "board";
		case "one_off":
			return opts.setupIncomplete ? "details" : "timeline";
		case "session":
			return "calendar";
		case "task":
			return "";
	}
}

/** `/projects/{slug}` plus {@link engagementHomeSeg}. */
export function engagementHomeHref(
	slug: string,
	archetype: EngagementArchetype,
	opts: { setupIncomplete?: boolean } = {},
): string {
	const seg = engagementHomeSeg(archetype, opts);
	return seg ? `/projects/${slug}/${seg}` : `/projects/${slug}`;
}
// #endregion
