import type { ComponentChildren } from "preact";
import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext, type UserContext } from "@projective/types/auth";
import { NavItem } from "@projective/ui/navigation";
import { UserShell } from "@web/features/shell/components/UserShell.tsx";
import { NavIcon } from "@web/features/shell/core/nav-icons.tsx";
import { resolveProjectsFeed } from "@web/features/projects/core/feed-ssr.ts";
import { resolveProjectDetail } from "@web/features/projects/core/detail-ssr.ts";
import { resolveSessionKind } from "@web/features/projects/core/session-model.ts";
import { channelHeaderFor } from "@web/features/projects/core/channel-header-slot.tsx";
import { projectHeaderFor } from "@web/features/projects/core/project-header-slot.tsx";
import { channelFooterFor } from "@web/features/projects/core/channel-footer-slot.tsx";
import { filesFooterFor } from "@web/features/projects/core/files-footer-slot.tsx";
import { submissionsFooterFor } from "@web/features/projects/core/submissions-footer-slot.tsx";
import { boardFooterFor } from "@web/features/projects/core/board-footer-slot.tsx";
import { conversationHeaderFor } from "@web/features/messaging/core/conversation-header-slot.tsx";
import { conversationFooterFor } from "@web/features/messaging/core/conversation-footer-slot.tsx";
import { catalogueLaneFor } from "@web/features/catalogue/core/catalogue-lane-slot.tsx";
import { catalogueFooterFor } from "@web/features/catalogue/core/catalogue-footer-slot.tsx";
import { walletLaneFor } from "@web/features/wallet/core/wallet-lane-slot.tsx";
import { walletFooterFor } from "@web/features/wallet/core/wallet-footer-slot.tsx";
import { walletHeaderFor } from "@web/features/wallet/core/wallet-header-slot.tsx";
import {
	resolveConversationList,
	resolveMessagingSettings,
} from "@web/features/messaging/core/conversations-ssr.ts";
import ProjectsLane from "@web/features/projects/islands/ProjectsLane.island.tsx";
import ProjectSidebar from "@web/features/projects/islands/ProjectSidebar.island.tsx";
import MessagesSidebar from "@web/features/messaging/islands/MessagesSidebar.island.tsx";
import ChatPopoutHost from "@web/features/messaging/islands/ChatPopoutHost.island.tsx";

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
 * engagement, {@link projectHeaderFor} mounts the role-based Preview/Edit header on the bare engagement
 * page + its editor, and {@link channelFooterFor} mounts the Chat composer on that channel's Chat tab;
 * all collapse everywhere else. Resolving the composer as a frame footer (not inside the scrolling
 * body) pins it to the viewport bottom under the native window scroll (Decision #31).
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
 * `null` for the feed root. Drives the lane's feed-vs-sidebar switch — a single open engagement
 * replaces the feed with the contextual Project Details sidebar. (`/projects/create` is retired — the
 * standalone page was replaced by the in-lane Project Creation Modal; `create` is still mapped to the
 * feed defensively so a stale link keeps the feed lane rather than a project sidebar.)
 */
function projectSlugOf(pathname: string): string | null {
	const segs = pathname.split("/").filter(Boolean); // ["projects", slug, ...]
	if (segs[0] !== "projects" || segs.length < 2) return null;
	const slug = segs[1];
	return slug === "create" ? null : slug;
}

/**
 * Resolve the middle-nav footer band for a request: the channel/conversation Chat composer on a Chat
 * tab, the File Explorer's View Control Rig on a `/files` route, the Submissions rig on
 * `/submissions`, the Board rig on `/board`, else nothing. Composed so exactly one owns the single
 * footer slot per URL. Every navigation is a full page render, so this simply resolves fresh each time.
 */
function middleNavFooterFor(url: URL, context: UserContext): ComponentChildren {
	return channelFooterFor(url, context) ?? filesFooterFor(url, context) ??
		submissionsFooterFor(url, context) ?? boardFooterFor(url, context) ??
		conversationFooterFor(url, context) ?? catalogueFooterFor(url, context) ??
		walletFooterFor(url, context);
}

/**
 * Resolve the middle-nav header band: the project channel header on a channel route, the project
 * Preview/Edit header on the bare engagement, or the global-inbox conversation header on a
 * `/messages/[conversationId]` route. Exactly one owns the single header slot per URL.
 */
function middleNavHeaderFor(url: URL, context: UserContext): ComponentChildren {
	return channelHeaderFor(url, context) ?? projectHeaderFor(url, context) ??
		conversationHeaderFor(url, context) ?? walletHeaderFor(url, context);
}

/**
 * Resolve the middle-nav lane for a request: the contextual Project Details sidebar on a specific
 * `/projects/{slug}`, the projects feed on the `/projects` root (+ `/projects/create`), else the
 * default section switcher.
 */
function laneFor(url: URL, context: UserContext): ComponentChildren {
	// The global inbox (`/messages`) hosts the conversation search + advanced filters + New/Settings lane.
	if (url.pathname.startsWith("/messages")) {
		const { page, role } = resolveConversationList(context);
		const settings = resolveMessagingSettings(context) ??
			{
				autoResponsesEnabled: false,
				autoResponses: [],
				readReceipts: true,
				showTypingIndicator: true,
				notifications: {
					newMessage: true,
					mentions: true,
					groupActivity: true,
					serviceInquiries: true,
					sound: true,
					muteAll: false,
					quietHoursEnabled: false,
					quietStart: "22:00",
					quietEnd: "08:00",
				},
			};
		return <MessagesSidebar initial={page} role={role} path={url.pathname} settings={settings} />;
	}

	// The seller Catalogue (`/catalogue`) hosts its navigation lane (status sections · filters · ＋ New).
	if (url.pathname.startsWith("/catalogue")) return catalogueLaneFor(url, context);

	// The Wallet (`/wallet`) hosts its finance lane (account switcher + capability-gated sub-nav).
	if (url.pathname.startsWith("/wallet")) return walletLaneFor(url, context);

	if (!url.pathname.startsWith("/projects")) return sectionLane();

	const slug = projectSlugOf(url.pathname);
	if (slug) {
		const { detail } = resolveProjectDetail(slug, context);
		// The SSR archetype baseline (from the engagement format); the island re-derives it live from
		// the dev Context Switcher so a simulated session swaps the sidebar body without a reload.
		const sessionKind = detail ? resolveSessionKind(detail.format, null) : "none";
		return (
			<ProjectSidebar detail={detail} slug={slug} path={url.pathname} sessionKind={sessionKind} />
		);
	}

	const feed = resolveProjectsFeed(url, context);
	return (
		<ProjectsLane
			initialParams={feed.params}
			initial={feed.payload}
			activeContextId={feed.activeContextId}
			activeContextLabel={feed.activeContextLabel}
			canOfferServices={feed.canOfferServices}
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
			protectedRoute
			lane={laneFor(ctx.url, context)}
			middleNavHeader={middleNavHeaderFor(ctx.url, context)}
			middleNavFooter={middleNavFooterFor(ctx.url, context)}
		>
			{/* Global floating "Pop Out Chat" host — survives navigations, re-seeds from sessionStorage. */}
			<ChatPopoutHost path={path} />
			<ctx.Component />
		</UserShell>
	);
});
