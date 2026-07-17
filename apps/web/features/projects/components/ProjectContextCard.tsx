import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { boardView } from "./detail-glyphs.tsx";
import { profileHref } from "../core/routing.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * ProjectContextCard — the card-LESS identity header of the Project Details sidebar. It no longer sits
 * inside a tonal box; the elements rest directly on the lane surface and are set off from the channel
 * tree below by a single hairline divider (rendered by the island), keeping the region borderless per
 * the §B.4 separation hierarchy.
 *
 * Layout: the leading party's LARGE avatar on the left (a **project** leads with its owner, a
 * **service** with the client it's delivered for), the title + a single clickable owner/client name
 * stacked to its right, and — pinned top-right — a lone icon-only project-type glyph
 * (Pipeline · Timeline · Calendar) whose portal {@link Tooltip} names the engagement type. Beneath sits
 * the interactive, truncated description: hovering shifts its colour (darker in light mode, lighter in
 * dark) and clicking it — or the "Show details" affordance — routes to the engagement's main page
 * (`/projects/{slug}`).
 */
export interface ProjectContextCardProps {
	detail: ProjectDetail;
}

export function ProjectContextCard({ detail }: ProjectContextCardProps): JSX.Element {
	const isService = detail.kind === "service";
	// A project leads with its owner; a service leads with the client. Fall back to the owner so the
	// header always has an identity even for a client-less internal draft.
	const lead = (isService ? detail.client : detail.owner) ?? detail.owner;
	const detailsHref = `/projects/${detail.slug}`;
	const board = boardView(detail.format, detail.kind);
	const typeTip = `${board.label} ${isService ? "service" : "project"}`;

	return (
		<header class="proj-ctx" data-kind={detail.kind} aria-label={`${typeTip} overview`}>
			<div class="proj-ctx__top">
				<span class="proj-ctx__avatar">
					<Avatar
						image={lead.avatar ?? undefined}
						label={lead.name}
						size={48}
						shape="circle"
					/>
				</span>

				<div class="proj-ctx__idblock">
					<h1 class="proj-ctx__title">{detail.title}</h1>
					{lead.handle
						? (
							<a
								class="proj-ctx__owner-name"
								href={profileHref(lead.handle)}
								aria-label={`View ${lead.name}'s profile`}
							>
								{lead.name}
							</a>
						)
						: (
							<span class="proj-ctx__owner-name proj-ctx__owner-name--static">
								{lead.name}
							</span>
						)}
				</div>

				{/* Lone project-type glyph — the written badge is retired; the type reads on hover only. */}
				<Tooltip content={typeTip} placement="bottom-end">
					<span class="proj-ctx__type" aria-label={typeTip}>{board.icon}</span>
				</Tooltip>
			</div>

			{/* The whole description is the interactive reveal into the main page (§B.6 icon-first: the
			    words live here, the action is the hover/click). */}
			<a class="proj-ctx__desc" href={detailsHref} aria-label="Open project details">
				<span class="proj-ctx__desc-text">{detail.description}</span>
				<span class="proj-ctx__show">Show details</span>
			</a>
		</header>
	);
}
