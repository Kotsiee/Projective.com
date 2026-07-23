import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ProjectStickyHeader from "@features/view/islands/ProjectStickyHeader.island.tsx";
import ProjectPreviewTabs from "../islands/ProjectPreviewTabs.island.tsx";
import { resolveProjectShowcase } from "./showcase-ssr.ts";

/**
 * project-header-slot — the SSR-idiomatic resolver for the ROLE-BASED middle-nav header on the Project
 * Preview / Edit routes (root brief §Part 1). It mirrors the shell's other URL-keyed slot resolvers
 * (`channelHeaderFor` / `viewHeaderFor`): a pure function of the URL (+ the acting context), evaluated by
 * the `(dashboard)` layout and threaded into `UserShell`'s `middleNavHeader`, so the correct header
 * paints on the first byte with no client-context flash. Composed AFTER `channelHeaderFor`, which owns
 * the channel routes — this only claims the bare engagement page (`/projects/[id]`) and its editor
 * (`/projects/[id]/edit`).
 *
 * Role gating (re-derived server-side from `viewerIsClient`, never trusted from the client — root
 * CLAUDE.md §6):
 *   • **Client / owner** → the {@link ProjectPreviewTabs} Preview↔Edit switch.
 *   • **Freelancer / non-owner** → the reused view {@link ProjectStickyHeader} (reveal-on-scroll identity
 *     + Apply), so the header looks and functions identically to `/view/[id]?type=projects` and the Edit
 *     tab is never shown. (The `/edit` route itself is guarded, so a non-owner only reaches Preview.)
 *
 * Server-only (it reaches `@server/services` via {@link resolveProjectShowcase}); never imported by an
 * island.
 */
export function projectHeaderFor(url: URL, context: UserContext): ComponentChildren {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", slug, ...rest]
	if (segs[0] !== "projects" || segs.length < 2 || segs[1] === "create") return null;

	const slug = segs[1];
	// Only the bare engagement page and its editor carry this header (not board/files/submissions/…,
	// nor a channel route — that is `channelHeaderFor`'s).
	const mode: "preview" | "edit" | null = segs.length === 2
		? "preview"
		: (segs.length === 3 && segs[2] === "edit")
		? "edit"
		: null;
	if (!mode) return null;

	const { detail, showcase, viewerIsClient } = resolveProjectShowcase(slug, context);
	if (!detail || !showcase) return null;

	if (viewerIsClient) {
		return <ProjectPreviewTabs slug={slug} active={mode} title={detail.title} />;
	}

	// Non-owner: mirror the public entity-view header (reveal-on-scroll sticky identity + Apply). Authed
	// (the whole dashboard is behind the auth guard); the projects scope has no back-to-explore/profile
	// context so the neutral `explore` scope drives the owner link + apply-sign-in fallback.
	return <ProjectStickyHeader item={showcase.item} authed ctx={{ scope: "explore" }} />;
}
