import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import type { EntityView, ProjectViewExtra } from "@projective/types/explore";
import { MetaLine, Section, SellerLine, SpecLedger } from "./entity-view-parts.tsx";
import { StageProgressLedger } from "./StageProgressLedger.tsx";
import { inlineMetaFor } from "../core/entity-archetype.ts";
import {
	PROJECT_CURRENCY,
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
 * # The banner survives, quieter
 *
 * The client's profile banner used to be the page's 7:2 hero with a 112px avatar overlapping it — a
 * profile page's chrome on a listing. It is now a slim strip at the top of the hero, with the
 * client's face overlapping its lower edge at half height: the same two facts (who posted this, and
 * their visual identity) at a Cord / LinkedIn listing's prominence rather than a profile's. The strip
 * is decorative — `alt=""`, `aria-hidden` — because the seller line beneath it states the identity
 * in words.
 */

// #region Hero
export function ProjectHero(
	{ view, project }: { view: EntityView; project: ProjectViewExtra },
): JSX.Element {
	const { item } = view;
	const rating = item.rating?.asClient ?? item.rating?.asHelper ?? null;
	const meta = inlineMetaFor(view, "project");

	return (
		<div class="evp-overview evp-overview--project">
			<div class="evp-banner" aria-hidden="true">
				<img class="evp-banner__img" src={project.banner} alt="" loading="eager" decoding="async" />
				<Avatar
					image={item.owner.avatar}
					label={item.owner.name}
					size={64}
					shape={item.owner.kind === "business" ? "square" : "circle"}
					class="evp-banner__avatar"
				/>
			</div>

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
				rating={rating}
				responseMinutes={view.responseMinutes}
				avatar={false}
				headline={project.ownerHeadline}
			/>
		</div>
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
						currency={PROJECT_CURRENCY}
					/>
				</Section>
			)}
		</>
	);
}
// #endregion
