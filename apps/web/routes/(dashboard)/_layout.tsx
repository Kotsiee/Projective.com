import type { ComponentChildren } from "preact";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext, type UserContext } from "@projective/types/auth";
import { NavItem } from "@projective/ui/navigation";
import { UserShell } from "@web/features/shell/components/UserShell.tsx";
import { NavIcon } from "@web/features/shell/core/nav-icons.tsx";
import { resolveProjectsFeed } from "@web/features/projects/core/feed-ssr.ts";
import { resolveProjectDetail } from "@web/features/projects/core/detail-ssr.ts";
import { channelHeaderFor } from "@web/features/projects/core/channel-header-slot.tsx";
import { channelFooterFor } from "@web/features/projects/core/channel-footer-slot.tsx";
import ProjectsLane from "@web/features/projects/islands/ProjectsLane.island.tsx";
import ProjectSidebar from "@web/features/projects/islands/ProjectSidebar.island.tsx";

/**
 * Dashboard shell — the authenticated app surface. Delegates the full unified matrix (DESIGN_SYSTEM.md
 * Part D) to the shared {@link UserShell}: glass header (brand · structural search · notifications /
 * create / basket / profile) → collapsible cached global sidebar → drag-resizable middle-nav lane →
 * PageCanvas. The same shell renders on authed public routes so Home/Explore match when signed in.
 *
 * The middle-nav lane is path-aware: on `/projects/*` it hosts the high-density, context-scoped
 * projects feed (SSR-resolved for a zero-round-trip first paint); every other section keeps the
 * compact section switcher. The frame's header + footer bands are likewise path-aware —
 * {@link channelHeaderFor} mounts the channel header on a specific `/projects/[projectId]/[channelId]`
 * engagement, and {@link channelFooterFor} mounts the Chat composer on that channel's Chat tab; both
 * collapse everywhere else. Resolving the composer as a frame footer (not inside the scrolling body)
 * pins it to the viewport bottom under the native window scroll (Decision #31).
 */

/** The default section switcher shown in the lane for non-projects dashboard routes. */
function sectionLane(): ComponentChildren {
	return (
		<nav class="lane-nav" aria-label="Section">
			<NavItem href="/messages" label="Inbox" icon={<NavIcon name="messages" />} />
			<NavItem href="/projects" label="All projects" icon={<NavIcon name="projects" />} />
			<NavItem href="/services" label="Services" icon={<NavIcon name="services" />} />
		</nav>
	);
}

/**
 * The routed project slug when the path is a SPECIFIC engagement (`/projects/{slug}` or deeper), or
 * `null` for the feed root and the `/projects/create` composer. Drives the lane's feed-vs-sidebar
 * switch — a single open engagement replaces the feed with the contextual Project Details sidebar.
 */
function projectSlugOf(pathname: string): string | null {
	const segs = pathname.split("/").filter(Boolean); // ["projects", slug, ...]
	if (segs[0] !== "projects" || segs.length < 2) return null;
	const slug = segs[1];
	return slug === "create" ? null : slug;
}

/**
 * Resolve the middle-nav lane for a request: the contextual Project Details sidebar on a specific
 * `/projects/{slug}`, the projects feed on the `/projects` root (+ `/projects/create`), else the
 * default section switcher.
 */
function laneFor(url: URL, context: UserContext): ComponentChildren {
	if (!url.pathname.startsWith("/projects")) return sectionLane();

	const slug = projectSlugOf(url.pathname);
	if (slug) {
		const { detail } = resolveProjectDetail(slug, context);
		return <ProjectSidebar detail={detail} slug={slug} path={url.pathname} />;
	}

	const feed = resolveProjectsFeed(url, context);
	return (
		<ProjectsLane
			initialParams={feed.params}
			initial={feed.payload}
			activeContextId={feed.activeContextId}
			activeContextLabel={feed.activeContextLabel}
			path={url.pathname}
		/>
	);
}

export default define.page(function DashboardLayout(ctx) {
	const path = ctx.url.pathname;
	const context = asAuthenticatedContext(ctx.state.userContext);
	return (
		<UserShell
			path={path}
			context={context}
			lane={laneFor(ctx.url, context)}
			middleNavHeader={channelHeaderFor(ctx.url, context)}
			middleNavFooter={channelFooterFor(ctx.url, context)}
		>
			<ctx.Component />
		</UserShell>
	);
});
