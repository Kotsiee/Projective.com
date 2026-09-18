import type { JSX } from "preact";
import { PairGrid } from "./PairGrid.tsx";
import { ProjectCard } from "../cards/ProjectCard.tsx";
import type { HrefContext } from "../../core/routing.ts";
import type { ExploreItem, ProjectItem } from "../../types/explore-types.ts";

/**
 * ProjectsList — open projects as a {@link PairGrid} of {@link ProjectCard}s: two equal columns where
 * the content region can hold them, one column where it cannot.
 *
 * Two columns, never auto-fit: a project card is a bounded brief — a header, a title, a stage
 * pipeline, three lines of summary, a skill row — so its height is predictable and two equal columns
 * pack it without the ragged bottom edge an auto-fit track produces when the last row is short. It is
 * also the layout that stops projects reading as a ranked list: a full-width row implies an order that
 * an open call does not have. The collapse to one column is the grid's own (a container query), so
 * a narrow feed beside the filter lane and a phone both get whole, readable cards rather than two
 * crushed ones.
 *
 * `onSelect` wires the Search-Results detail drawer, where this grid IS the feed; every other host
 * (the profile's Work tab) leaves it unset and a click navigates.
 */
export function ProjectsList(
	{ items, ctx, onSelect, authed = false, label = "Open projects" }: {
		items: ProjectItem[];
		ctx?: HrefContext;
		onSelect?: (item: ExploreItem) => void;
		authed?: boolean;
		label?: string;
	},
): JSX.Element {
	return (
		<PairGrid
			items={items}
			label={label}
			keyOf={(p) => p.id}
			render={(p) => <ProjectCard item={p} ctx={ctx} onSelect={onSelect} authed={authed} />}
		/>
	);
}
