import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import ProjectPreviewRig from "../islands/ProjectPreviewRig.island.tsx";
import ProjectSetupRig from "../islands/ProjectSetupRig.island.tsx";
import { resolveProjectShowcase } from "./showcase-ssr.ts";
import { resolveProjectSetup } from "./setup-ssr.ts";
import type { ReadActor } from "@server/services/read-actor.ts";

/**
 * project-footer-slot — the SSR-idiomatic resolver for the engagement's action rig in the middle-nav
 * FOOTER band. The sibling of {@link projectHeaderFor}, composed alongside the other footer resolvers
 * in the `(dashboard)` layout so exactly one footer wins per URL.
 *
 * It claims only the bare engagement page (`/projects/[projectId]`) — not the preview, whose whole
 * point is that there is nothing to act on there yet, and not board/files/submissions/channels, which
 * have their own rigs.
 *
 * Role gating mirrors {@link projectHeaderFor} and is re-derived server-side from `viewerIsClient`
 * (root CLAUDE.md §6):
 *   • **Client / owner** → the {@link ProjectSetupRig}: Save · Discard · Publish · Archive. The band is
 *     where every action on this surface lives, so the body can stay a form and nothing else (the
 *     shell's region contract, DESIGN_SYSTEM.md Part D).
 *   • **Freelancer / member** → the {@link ProjectPreviewRig}, so the engagement's one call to action
 *     is visible without scrolling for it.
 *
 * Server-only (it reaches `@server/services`); never imported by an island.
 */
export async function projectFooterFor(
	url: URL,
	context: UserContext,
	actor: ReadActor,
): Promise<ComponentChildren> {
	const segs = url.pathname.split("/").filter(Boolean); // ["projects", slug]
	if (segs[0] !== "projects" || segs.length !== 2 || segs[1] === "create") return null;

	const slug = segs[1];
	const { showcase, viewerIsClient } = await resolveProjectShowcase(slug, context, actor);
	if (!showcase) return null;

	if (!viewerIsClient) return <ProjectPreviewRig item={showcase.item} authed />;

	const { setup } = await resolveProjectSetup(slug, actor);
	if (!setup) return null;
	return <ProjectSetupRig setup={setup} />;
}
