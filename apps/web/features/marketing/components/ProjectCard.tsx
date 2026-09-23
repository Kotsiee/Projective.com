import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { ProgressBar } from "@projective/ui/feedback";
import { type ProjectShowcase, routes } from "../core/landing-data.ts";
import { vars } from "../core/style.ts";

/**
 * ProjectCard — an open project in the high-contrast projects grid. The card is the route action
 * (anchor → the project's public view). Surfaces the budget, the current stage, the roles being hired,
 * and how far through its stage plan the project is (library {@link ProgressBar}). Zero client JS.
 *
 * The cover is the client's banner; a project whose client has none shows the tonal band alone, and
 * a project that states no budget shows no figure — the card never invents either.
 *
 * This is the ONE landing card that deliberately keeps its own `.lp-*` presentation while services,
 * products and profiles moved onto the canonical `.ex-card` contract. The difference is the entity's,
 * not history's: discovery renders a project as `.ex-card--project`, a compact bordered brief built for
 * comparing many side by side, while the landing page presents a handful of open pipelines as hero
 * objects with a cover and a progress meter. Neither can do the other's job. Both are correct.
 */
export function ProjectCard({ project }: { project: ProjectShowcase }): JSX.Element {
	return (
		<a
			class="lp-card lp-project"
			href={routes.project(project.slug)}
			style={vars({ "--lp-cover": project.thumb ? `url("${project.thumb}")` : "none" })}
			aria-label={[project.title, `for ${project.org}`, project.budget].filter(Boolean).join(" — ")}
		>
			<div class="lp-project__media" aria-hidden="true" />
			<div class="lp-project__body">
				<div class="lp-project__head">
					{project.stage && <span class="lp-project__stage">{project.stage}</span>}
					<span class="lp-project__org">{project.org}</span>
				</div>
				<h3 class="lp-project__title">{project.title}</h3>
				<div class="lp-project__roles">
					{project.roles.map((r) => <Tag key={r} value={r} variant="outlined" rounded />)}
				</div>
				<div class="lp-project__meter">
					<ProgressBar value={project.progress} aria-label="Progress through the stage plan" />
				</div>
				{
					/* No trailing "Open board →" pseudo-button: the whole card is already the anchor, so it
				    announced an action the user was standing on and competed with the budget for the
				    foot's attention. The budget is the fact worth reading here. */
				}
				<div class="lp-project__foot">
					<span class="lp-project__budget">{project.budget}</span>
					{project.roles.length > 0 && (
						<span class="lp-project__stagecount">
							{project.roles.length} {project.roles.length === 1 ? "role" : "roles"} open
						</span>
					)}
				</div>
			</div>
		</a>
	);
}
