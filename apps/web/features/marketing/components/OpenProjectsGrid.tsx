import type { JSX } from "preact";
import { Grid } from "@projective/ui/layout";
import { ProjectCard } from "./ProjectCard.tsx";
import type { ProjectShowcase } from "../core/landing-data.ts";

/**
 * OpenProjectsGrid — a high-contrast, perfectly aligned auto-fit grid of open pipelines. Uses the
 * library {@link Grid} primitive (responsive `minChildWidth` auto-fit) so the structure stays fluid
 * across breakpoints with no app-side overrides. Zero client JS.
 */
export function OpenProjectsGrid({ projects }: { projects: ProjectShowcase[] }): JSX.Element {
	return (
		<Grid minChildWidth="20rem" gap={5} class="lp-projects__grid" role="list">
			{projects.map((p) => (
				<div role="listitem" key={p.slug} class="lp-projects__cell">
					<ProjectCard project={p} />
				</div>
			))}
		</Grid>
	);
}
