import type { JSX } from "preact";
import { Tag } from "@projective/ui/display";
import { ProgressBar } from "@projective/ui/feedback";
import { type ProjectShowcase, routes } from "../core/landing-data.ts";
import { vars } from "../core/style.ts";

/**
 * ProjectCard — an open pipeline in the high-contrast projects grid. The card is the route action
 * (anchor → project board). Surfaces the escrow budget, the current lifecycle stage, the roles being
 * hired, and staged delivery progress (library {@link ProgressBar}). Zero client JS.
 */
export function ProjectCard({ project }: { project: ProjectShowcase }): JSX.Element {
	return (
		<a
			class="lp-card lp-project"
			href={routes.project(project.slug)}
			style={vars({ "--lp-cover": `url("${project.thumb}")` })}
			aria-label={`${project.title} for ${project.org} — ${project.budget}`}
		>
			<div class="lp-project__media" aria-hidden="true" />
			<div class="lp-project__body">
				<div class="lp-project__head">
					<span class="lp-project__stage">{project.stage}</span>
					<span class="lp-project__org">{project.org}</span>
				</div>
				<h3 class="lp-project__title">{project.title}</h3>
				<div class="lp-project__roles">
					{project.roles.map((r) => <Tag key={r} value={r} variant="outlined" rounded />)}
				</div>
				<div class="lp-project__meter">
					<ProgressBar value={project.progress} aria-label="Delivery progress" />
				</div>
				<div class="lp-project__foot">
					<span class="lp-project__budget">{project.budget}</span>
					<span class="lp-project__cta">Open board →</span>
				</div>
			</div>
		</a>
	);
}
