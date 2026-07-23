import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import "@features/profile/styles/profile.css";
import "../styles/project-view.css";
import { ProjectActions } from "../components/ProjectActions.tsx";
import { viewHeaderCondensed } from "../core/view-state.ts";
import type { ExploreItem } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ProjectStickyHeader — the condensed project identity that MIGRATES into the middle-nav frame's header
 * band (`ui-middle-nav__header`) as the body `ProjectViewHeader` scrolls away. It reuses the profile
 * page's `.pf-stickyhead` skeleton VERBATIM (reading the shared `viewHeaderCondensed` signal and
 * stamping `data-condensed`, which CSS uses to slide the band open from 0 via `max-block-size`), so the
 * sticky/scroll transition matches the profile page exactly. It carries the uploader avatar, the project
 * title, and the single Apply CTA (reused from `ProjectActions`).
 */
export interface ProjectStickyHeaderProps {
	item: ExploreItem;
	authed: boolean;
	ctx: HrefContext;
}

export default function ProjectStickyHeader(
	{ item, authed, ctx }: ProjectStickyHeaderProps,
): JSX.Element {
	const condensed = viewHeaderCondensed.value;
	const owner = item.owner;
	return (
		<div
			class="pf-stickyhead vw-projsticky"
			data-condensed={condensed ? "true" : "false"}
			aria-hidden={condensed ? undefined : "true"}
		>
			<a class="pf-stickyhead__id" href={`/${owner.handle}`}>
				<Avatar
					image={owner.avatar}
					label={owner.name}
					size={30}
					shape={owner.kind === "business" ? "square" : "circle"}
				/>
				<span class="pf-stickyhead__name">{item.title}</span>
				<span class="pf-stickyhead__handle">{owner.name}</span>
			</a>
			<div class="pf-stickyhead__actions">
				<ProjectActions item={item} authed={authed} ctx={ctx} />
			</div>
		</div>
	);
}
