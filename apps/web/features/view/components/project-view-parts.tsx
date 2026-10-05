import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { EntityView, ProjectViewExtra } from "@projective/types/explore";
import { MetaLine, Section, SellerLine, SpecLedger } from "./entity-view-parts.tsx";
import { StageProgressLedger } from "./StageProgressLedger.tsx";
import { inlineMetaFor } from "../core/entity-archetype.ts";
import {
	projectCurrency,
	projectDetailRows,
	projectRoles,
	projectStagesHeading,
} from "../core/project-view-model.ts";

/**
 * Entity View — the Projects archetype's hero and body (`/view/[id]?type=projects`).
 *
 * Both are SERVER components composed from the same unboxed primitives every commerce archetype
 * uses (`Section` · `MetaLine` · `SpecLedger` · `StageProgressLedger`), so a brief being staffed
 * and a service being sold read as one design system: identical section registers, identical
 * asymmetric spacing (§B.4.1), zero cards around static content (§B.9.7), zero pills around
 * metadata (§B.11).
 *
 * # The Gutenberg reading gravity
 *
 * A project has no media column, so its hero spans the frame's two content tracks and its title is
 * the page's PRIMARY optical area — top-left after the start strip. The conversion lane's identity
 * band and ticket price are the STRONG follow area (top-right); the details ledger and the stage
 * run are the WEAK follow (the body); and the lane's pinned footer carries the single Apply CTA as
 * the TERMINAL area (bottom-right). Below the frame breakpoint the lane is not rendered and
 * `ProjectApplyBar` re-homes the transaction into the body — moved, never duplicated (§D.7.4).
 *
 * # No banner
 *
 * The client's profile banner was a slim decorative strip at the top of this hero (Decision #96(B)).
 * It is gone (Decision #142): the title is the page's primary optical area, and a strip above it was
 * the one thing standing between the reader and it. The identity it carried is stated by the seller
 * line — the client's face, name and role headline — which is where a listing states it.
 */

// #region Hero
export function ProjectHero(
	{ view, project, reviewsHref }: {
		view: EntityView;
		project: ProjectViewExtra;
		/** The client-reviews anchor the score jumps to — omitted where the page renders no reviews. */
		reviewsHref?: string;
	},
): JSX.Element {
	const { item } = view;
	const rating = item.rating?.asClient ?? item.rating?.asHelper ?? null;
	const meta = inlineMetaFor(view, "project");

	return (
		<div class="evp-overview evp-overview--project">
			<h1 class="evp-overview__title">{item.title}</h1>

			{
				/*
			  Metadata as ONE muted middot-separated line (§B.11.2): the live stage, the classification
			  and the leading skills. The classification used to be a tinted pill in the title and the
			  stage a second pill beneath it — neither could be clicked, and containment is a promise
			  of interactivity.
			*/
			}
			<MetaLine items={meta} />

			<p class="evp-overview__summary">{item.summary}</p>

			<SellerLine
				item={item}
				seller={view.seller}
				rating={rating}
				responseMinutes={view.responseMinutes}
				headline={project.ownerHeadline}
				reviewsHref={reviewsHref}
			/>
		</div>
	);
}
// #endregion

// #region Preview notice
/**
 * The owner's preview banner — the first row of the frame on `/projects/[slug]/preview`, where the
 * public page has its back link.
 *
 * Non-intrusive by construction: one sentence of Meta-register text on the page's own ground, an
 * `eye` glyph and a link back to Details. No fill, no border, no dismiss — it is a fact about the
 * page, not an alert, and a box around it would be static content in a container (§B.9.7). It is a
 * `role="note"` rather than a live region: it is there on arrival and never changes.
 */
export function PreviewNotice({ editHref }: { editHref?: string }): JSX.Element {
	return (
		<p class="evp-previewnote" role="note">
			<Icon name="eye" size="sm" class="evp-previewnote__icon" aria-hidden />
			<span class="evp-previewnote__text">
				This is how freelancers and applicants evaluate your project brief.
			</span>
			{editHref && <a class="evp-previewnote__link" href={editHref}>Edit details</a>}
		</p>
	);
}
// #endregion

// #region Body
/**
 * The project's evaluation body: the classification-tailored details ledger, the roles the brief is
 * hiring for, and the stage run on the shared timeline track (§D.8.1) with its seat facts shown.
 *
 * It carries NO price and NO apply control on desktop — the offer has exactly one home (§D.7.3).
 */
export function ProjectBody(
	{ view, project }: { view: EntityView; project: ProjectViewExtra },
): JSX.Element {
	const roles = projectRoles(view);
	const isOneOff = project.classification !== "pipeline";

	return (
		<>
			<Section title="Project details">
				<SpecLedger rows={projectDetailRows(view, project)} columns />
			</Section>

			{roles.length > 0 && (
				<Section title="Who this project needs">
					<MetaLine items={roles} class="evp-roles" />
				</Section>
			)}

			{project.stages.length > 0 && (
				<Section title={projectStagesHeading(project)}>
					<StageProgressLedger
						stages={project.stages}
						hideOrdinals={isOneOff && project.stages.length === 1}
						showSeats
						currency={projectCurrency(project)}
					/>
				</Section>
			)}
		</>
	);
}
// #endregion
