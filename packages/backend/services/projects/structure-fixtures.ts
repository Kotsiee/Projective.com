import type { ProjectFormat, ProjectStructure } from "@projective/types/projects";

/**
 * The fixture corpus's answer to `projects.projects.structure_variation` — the finer shape within a
 * format, for the stub read path.
 *
 * One module because three projections need it and they must not disagree: the setup form (which
 * sections to render), the detail read (whether the lane draws a Task's overview or a channel tree)
 * and the board (whether the ticket modal offers a Timeline). A Task that the lane calls a Task and the
 * form calls a milestone one-off would be the same engagement answering two different questions.
 *
 * @module
 */

/**
 * The finer shape within a format.
 *
 * A straight mapping with no inference. It would be easy to read "a one-off with no stages" as a
 * Direct Deliverable and set `single_task`, and it would be wrong: that also describes a one-off
 * whose owner has simply not added a stage yet, and the two answers put a DIFFERENT required step on
 * the ladder (`roles` instead of `stages`), so the guess would tell such an owner to go and staff
 * roles the form does not render for them.
 */
const STRUCTURE_FOR_FORMAT: Record<ProjectFormat, ProjectStructure> = {
	pipeline: "standard",
	one_off: "one_off",
	session: "single_stage",
};

/**
 * The engagements this corpus DECLARES to be Tasks (a Direct Deliverable — `one_off` + `single_task`).
 *
 * `ProjectSummary` carries no structure — it is a feed projection, and which sections a setup form
 * renders is not a feed concern — while `projects.projects.structure_variation` carries it on the live
 * path. Rather than widen the feed shape for one surface, the fixtures name the rows the same way the
 * profile corpus names its organisations: an explicit set, so the branch is reachable and reachable
 * for a stated reason.
 *
 * It matters that this is a declaration and not a derivation. `single_task` swaps the ladder's
 * required step from `stages` to `roles` and swaps the form's whole staffing section with it, so a
 * heuristic that guessed wrong would show an owner a section their engagement does not have and hold
 * their publish gate against it.
 */
const TASK_SLUGS: ReadonlySet<string> = new Set(["prj-cujw52gg3p"]);

/** The structure for a corpus row: its format's shape, unless the corpus declares it a Task. */
export function fixtureStructureOf(slug: string, format: ProjectFormat): ProjectStructure {
	if (format === "one_off" && TASK_SLUGS.has(slug)) return "single_task";
	return STRUCTURE_FOR_FORMAT[format];
}
