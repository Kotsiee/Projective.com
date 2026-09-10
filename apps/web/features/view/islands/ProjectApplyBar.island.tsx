import type { JSX } from "preact";
import "../styles/entity-view.css";
import type { EntityView, ProjectViewExtra } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";
import { PriceBlock } from "../components/lane-parts.tsx";
import { ProjectCtaRig } from "../components/ProjectCtaRig.tsx";
import { projectTicketPrice } from "../core/project-view-model.ts";

/**
 * ProjectApplyBar — the project's transactional block below the frame breakpoint
 * (`DESIGN_SYSTEM.md` §D.7.4), the twin of the commerce `EntityBuyBar`.
 *
 * Below the frame breakpoint the conversion lane is not rendered — it is a page column, and four
 * tracks inside a content region the shell has already narrowed leave too little for the content
 * itself. So the whole transaction lives here instead: the ticket-price figure and the Apply rig.
 *
 * **The duty TRANSFERS; it does not duplicate.** This block is revealed by container query exactly
 * where the lane is not, so the two are mutually exclusive by `display` and only ever one is in the
 * accessibility tree. Both derive their price from `projectTicketPrice` and their controls from the
 * SAME `ProjectCtaRig`, so the phone and the desktop cannot drift into quoting different things or
 * ranking them differently.
 */
export interface ProjectApplyBarProps {
	view: EntityView;
	project: ProjectViewExtra;
	authed: boolean;
	ctx: HrefContext;
}

export default function ProjectApplyBar(
	{ view, project, authed, ctx }: ProjectApplyBarProps,
): JSX.Element {
	const price = projectTicketPrice(project);
	return (
		<div class="evp-buybar">
			<PriceBlock
				amount={price.amount}
				fallback={price.fallback}
				unit={price.unit}
				isFloor={price.isFloor}
			/>
			<ProjectCtaRig item={view.item} authed={authed} ctx={ctx} layout="bar" />
		</div>
	);
}
