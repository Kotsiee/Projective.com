import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
// Mirror the profile page's banner/avatar chrome by reusing its `pf-header*` skeleton; `project-view.css`
// layers the project-specific meta/CTA styling on top.
import "@features/profile/styles/profile.css";
import "../styles/project-view.css";
import { ProfileIcon } from "@features/profile/components/profile-glyphs.tsx";
import { ViewIcon } from "../components/view-glyphs.tsx";
import { ProjectActions } from "../components/ProjectActions.tsx";
import { viewHeaderCondensed } from "../core/view-state.ts";
import type { ExploreItem, ProjectViewExtra } from "@projective/types/explore";
import type { HrefContext } from "@features/explore/core/routing.ts";

/**
 * ProjectViewHeader — the Projects view's main body header. It reuses the profile page's `pf-header`
 * banner (7:2) + overlapping circular avatar chrome VERBATIM, but swaps the identity block from a user
 * bio to the **project title, project-level metadata (owner · type · stage), and the project CTAs**.
 * The banner is the uploader's profile banner (resolved server-side) so the two surfaces agree.
 *
 * It also OWNS the scroll-migration probe — identical to `ProfileHeader`: a window-scroll listener flips
 * the shared `viewHeaderCondensed` signal once this header scrolls up under the sticky top bar, which
 * the `ProjectStickyHeader` island in the `ui-middle-nav__header` band reads to slide the condensed
 * identity in. Because it stamps the same `.pf-stickyhead[data-condensed]` mechanics, the sticky/scroll
 * transition is behaviourally identical to the profile page.
 */
export interface ProjectViewHeaderProps {
	item: ExploreItem;
	project: ProjectViewExtra;
	authed: boolean;
	ctx: HrefContext;
}

export default function ProjectViewHeader(
	{ item, project, authed, ctx }: ProjectViewHeaderProps,
): JSX.Element {
	const root = useRef<HTMLElement>(null);
	const owner = item.owner;

	useEffect(() => {
		const topbar = Number.parseInt(
			getComputedStyle(document.documentElement).getPropertyValue("--shell-topbar-h"),
			10,
		) || 48;
		const threshold = topbar + 24;
		const onScroll = () => {
			const el = root.current;
			if (!el) return;
			viewHeaderCondensed.value = el.getBoundingClientRect().bottom <= threshold;
		};
		onScroll();
		globalThis.addEventListener("scroll", onScroll, { passive: true });
		globalThis.addEventListener("resize", onScroll);
		return () => {
			globalThis.removeEventListener("scroll", onScroll);
			globalThis.removeEventListener("resize", onScroll);
		};
	}, []);

	const isPipeline = project.classification === "pipeline";

	return (
		<header class="pf-header vw-projhead" ref={root}>
			<div
				class="pf-header__banner"
				style={`background-image:url("${project.banner}")`}
				aria-hidden="true"
			/>
			<div class="pf-header__bar">
				<Avatar
					image={owner.avatar}
					label={owner.name}
					size={112}
					shape={owner.kind === "business" ? "square" : "circle"}
					class="pf-header__avatar"
				/>
				<div class="pf-header__id">
					<h1 class="pf-header__name">
						<span class="pf-header__nametext">{item.title}</span>
						<Tooltip
							content={isPipeline ? "Staged pipeline project" : "Single one-off project"}
							placement="top"
						>
							<span
								class="vw-projhead__class"
								data-class={project.classification}
								aria-label={`${project.classificationLabel} project`}
							>
								<ViewIcon name={isPipeline ? "stages" : "type"} size={14} />
								<span>{project.classificationLabel}</span>
							</span>
						</Tooltip>
					</h1>
					<div class="pf-header__idline vw-projhead__meta">
						<a
							class="vw-projhead__owner"
							href={`/${owner.handle}`}
							aria-label={`${owner.name} — view profile`}
						>
							<Avatar
								image={owner.avatar}
								alt=""
								size={20}
								shape={owner.kind === "business" ? "square" : "circle"}
							/>
							<span class="vw-projhead__owner-name">{owner.name}</span>
							{project.ownerVerified
								? <ProfileIcon name="verified" class="vw-projhead__verified" />
								: null}
						</a>
						{isPipeline && project.stage
							? (
								<>
									<span class="vw-projhead__dot" aria-hidden="true" />
									<span class="vw-projhead__badge" data-tone="stage">
										{project.stage}
									</span>
								</>
							)
							: null}
					</div>
					<p class="vw-projhead__summary">{project.ownerHeadline}</p>
				</div>
				<div class="pf-header__actions">
					<ProjectActions item={item} authed={authed} ctx={ctx} />
				</div>
			</div>
		</header>
	);
}
